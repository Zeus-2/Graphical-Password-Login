/**
 * Standalone client application - B-Team Login System
 * Runs entirely in the browser using localStorage
 */

console.log('main.js loaded successfully');

// ============================================================================
// CRYPTO UTILITIES
// ============================================================================

class CryptoUtils {
  static async sha256(message) {
    // Convert string to array buffer
    const msgBuffer = new TextEncoder().encode(message);
    // Hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    // Convert buffer to byte array
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Convert bytes to hex string
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  static async hashPassword(password) {
    return await this.sha256(password);
  }

  static async hashStudentCredentials(imageId, color, number) {
    // Create a combined string from the student's credentials
    const combined = `${imageId}:${color}:${number}`;
    return await this.sha256(combined);
  }

  static async verifyPassword(inputPassword, storedHash) {
    const inputHash = await this.sha256(inputPassword);
    return inputHash === storedHash;
  }

  static async verifyStudentCredentials(imageId, color, number, storedHash) {
    const inputHash = await this.hashStudentCredentials(imageId, color, number);
    return inputHash === storedHash;
  }
}

// ============================================================================
// AUDIT LOG
// ============================================================================

class AuditLog {
  static AUDIT_KEY = 'bteam_audit_log';
  static MAX_ENTRIES = 500;

  static log(action, details = {}) {
    const entries = this.getAll();
    entries.push({
      timestamp: Date.now(),
      action,
      ...details
    });
    // Keep only the most recent entries
    if (entries.length > this.MAX_ENTRIES) entries.splice(0, entries.length - this.MAX_ENTRIES);
    localStorage.setItem(this.AUDIT_KEY, JSON.stringify(entries));
  }

  static getAll() {
    return JSON.parse(localStorage.getItem(this.AUDIT_KEY) || '[]');
  }

  static getRecent(n = 100) {
    return this.getAll().slice(-n).reverse();
  }

  static clear() {
    localStorage.removeItem(this.AUDIT_KEY);
  }
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

class SessionManager {
  static TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes inactivity
  static SESSION_KEY = 'bteam_session';
  static _timer = null;

  static create(userId, role) {
    const session = {
      userId,
      role, // 'student' | 'teacher'
      loginTime: Date.now(),
      lastActivity: Date.now()
    };
    sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    this._resetTimer();
    AuditLog.log('LOGIN', { userId, role });
    // Persist last login time per user
    const lastLogins = JSON.parse(localStorage.getItem('bteam_last_logins') || '{}');
    lastLogins[userId] = Date.now();
    localStorage.setItem('bteam_last_logins', JSON.stringify(lastLogins));
  }

  static get() {
    const raw = sessionStorage.getItem(this.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  static touch() {
    const session = this.get();
    if (!session) return;
    session.lastActivity = Date.now();
    sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    this._resetTimer();
  }

  static destroy(reason = 'LOGOUT') {
    const session = this.get();
    if (session) {
      AuditLog.log(reason, { userId: session.userId, role: session.role });
    }
    sessionStorage.removeItem(this.SESSION_KEY);
    clearTimeout(this._timer);
    this._timer = null;
  }

  static _resetTimer() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const session = this.get();
      if (session) {
        this.destroy('SESSION_TIMEOUT');
        // Dispatch custom event so App can react
        window.dispatchEvent(new CustomEvent('session-timeout', { detail: session }));
      }
    }, this.TIMEOUT_MS);
  }

  static getLastLogin(userId) {
    const lastLogins = JSON.parse(localStorage.getItem('bteam_last_logins') || '{}');
    return lastLogins[userId] || null;
  }

  static isActive() {
    return !!this.get();
  }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

class Validator {
  static USERNAME_MIN = 2;
  static USERNAME_MAX = 30;
  static USERNAME_PATTERN = /^[a-zA-Z0-9 _'-]+$/;

  static validateUsername(userId) {
    if (!userId || !userId.trim()) return 'Please type your name first!';
    const trimmed = userId.trim();
    if (trimmed.length < this.USERNAME_MIN) return `Your name needs at least ${this.USERNAME_MIN} letters.`;
    if (trimmed.length > this.USERNAME_MAX) return `Your name is too long — keep it under ${this.USERNAME_MAX} letters.`;
    if (!this.USERNAME_PATTERN.test(trimmed)) return 'Only letters, numbers, spaces and - are allowed.';
    return null; // valid
  }

  static validateTeacherUsername(username) {
    if (!username || !username.trim()) return 'Please enter a username.';
    if (username.trim().length < 3) return 'Username must be at least 3 characters.';
    return null;
  }

  static validateTeacherPassword(password) {
    if (!password || !password.trim()) return 'Please enter a password.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }
}



class LocalDatabase {
  constructor() {
    console.log('LocalDatabase initializing...');
    this.USERS_KEY = 'bteam_login_users';
    this.IMAGES_KEY = 'bteam_login_images';
    this.TEACHERS_KEY = 'bteam_login_teachers';
    this.initializeImages();
    // Store the promise so callers can await it
    this.ready = this.initializeDefaultTeacher();
    console.log('LocalDatabase initialized');
  }

  async initializeDefaultTeacher() {
    console.log('Initializing default teacher...');
    const teachers = this.getTeachers();
    console.log('Existing teachers:', Object.keys(teachers));
    
    if (Object.keys(teachers).length === 0) {
      // Create default teacher account with hashed password
      const hashedPassword = await CryptoUtils.hashPassword('teacher123');
      teachers['teacher'] = {
        username: 'teacher',
        passwordHash: hashedPassword,
        name: 'Default Teacher',
        createdAt: Date.now()
      };
      localStorage.setItem(this.TEACHERS_KEY, JSON.stringify(teachers));
      console.log('Default teacher created with hashed password');
    } else {
      console.log('Teachers already exist');
    }
  }

  getTeachers() {
    return JSON.parse(localStorage.getItem(this.TEACHERS_KEY) || '{}');
  }

  getTeacherByUsername(username) {
    const teachers = this.getTeachers();
    return teachers[username] || null;
  }

  async createTeacher(username, password, name) {
    const teachers = this.getTeachers();
    if (teachers[username]) {
      throw new Error('Teacher already exists');
    }
    const passwordHash = await CryptoUtils.hashPassword(password);
    teachers[username] = {
      username,
      passwordHash,
      name,
      createdAt: Date.now()
    };
    localStorage.setItem(this.TEACHERS_KEY, JSON.stringify(teachers));
    return teachers[username];
  }

  initializeImages() {
    // Always update to ensure we have the latest 9 child-friendly animals
    const images = [
      { imageId: 'cat_001', fileName: 'cat.svg', displayName: 'Cat', path: 'public/images/cat.svg' },
      { imageId: 'dog_001', fileName: 'dog.svg', displayName: 'Dog', path: 'public/images/dog.svg' },
      { imageId: 'rabbit_001', fileName: 'rabbit.svg', displayName: 'Rabbit', path: 'public/images/rabbit.svg' },
      { imageId: 'penguin_001', fileName: 'penguin.svg', displayName: 'Penguin', path: 'public/images/penguin.svg' },
      { imageId: 'duck_001', fileName: 'duck.svg', displayName: 'Duck', path: 'public/images/duck.svg' },
      { imageId: 'pig_001', fileName: 'pig.svg', displayName: 'Pig', path: 'public/images/pig.svg' },
      { imageId: 'cow_001', fileName: 'cow.svg', displayName: 'Cow', path: 'public/images/cow.svg' },
      { imageId: 'sheep_001', fileName: 'sheep.svg', displayName: 'Sheep', path: 'public/images/sheep.svg' },
      { imageId: 'butterfly_001', fileName: 'butterfly.svg', displayName: 'Butterfly', path: 'public/images/butterfly.svg' }
    ];
    localStorage.setItem(this.IMAGES_KEY, JSON.stringify(images));
  }

  getAllImages() {
    return JSON.parse(localStorage.getItem(this.IMAGES_KEY) || '[]');
  }

  getImageById(imageId) {
    const images = this.getAllImages();
    return images.find(img => img.imageId === imageId);
  }

  getRandomImages(count, excludeIds = []) {
    const images = this.getAllImages().filter(img => !excludeIds.includes(img.imageId));
    const shuffled = images.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  getUsers() {
    return JSON.parse(localStorage.getItem(this.USERS_KEY) || '{}');
  }

  getUserById(userId) {
    const users = this.getUsers();
    // Case-insensitive lookup
    const normalizedUserId = userId.toLowerCase();
    const userKey = Object.keys(users).find(key => key.toLowerCase() === normalizedUserId);
    return userKey ? users[userKey] : null;
  }

  async createUser(userId, imageId, favoriteColor, luckyNumber, teacherUsername = null) {
    const users = this.getUsers();
    // Case-insensitive check for existing users
    const normalizedUserId = userId.toLowerCase();
    const existingKey = Object.keys(users).find(key => key.toLowerCase() === normalizedUserId);
    if (existingKey) {
      throw new Error('User already exists');
    }
    
    // Hash the student's credentials
    const credentialsHash = await CryptoUtils.hashStudentCredentials(imageId, favoriteColor, luckyNumber);
    
    users[userId] = {
      userId,
      credentialsHash,
      teacherUsername,
      createdAt: Date.now()
    };
    localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    AuditLog.log('USER_CREATED', { userId, teacherUsername });
    return users[userId];
  }

  async updateUserCredentials(userId, imageId, favoriteColor, luckyNumber, performedBy = null) {
    const users = this.getUsers();
    if (!users[userId]) {
      throw new Error('User not found');
    }
    
    const credentialsHash = await CryptoUtils.hashStudentCredentials(imageId, favoriteColor, luckyNumber);
    
    users[userId].credentialsHash = credentialsHash;
    users[userId].updatedAt = Date.now();
    localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    AuditLog.log('PASSWORD_RESET', { userId, performedBy });
    return users[userId];
  }

  deleteUser(userId, performedBy = null) {
    const users = this.getUsers();
    if (!users[userId]) {
      throw new Error('User not found');
    }
    delete users[userId];
    localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    AuditLog.log('USER_DELETED', { userId, performedBy });
  }

  getUsersByTeacher(teacherUsername) {
    const users = this.getUsers();
    return Object.values(users).filter(user => user.teacherUsername === teacherUsername);
  }

  getAllUsers() {
    return Object.values(this.getUsers());
  }

  getFailedAttemptCount(userId) {
    const ATTEMPTS_KEY = 'bteam_login_attempts';
    const attempts = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
    return attempts[userId]?.count || 0;
  }

  unlockUser(userId, performedBy = null) {
    // Clear failed attempts from localStorage
    const ATTEMPTS_KEY = 'bteam_login_attempts';
    const attempts = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
    if (attempts[userId]) {
      delete attempts[userId];
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
    }
    AuditLog.log('ACCOUNT_UNLOCKED', { userId, performedBy });
  }

  isUserLocked(userId) {
    const ATTEMPTS_KEY = 'bteam_login_attempts';
    const attempts = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
    const userAttempts = attempts[userId];
    return userAttempts && userAttempts.count >= 3;
  }

  // Database management functions
  clearAllData() {
    localStorage.removeItem(this.USERS_KEY);
    localStorage.removeItem(this.TEACHERS_KEY);
    localStorage.removeItem('bteam_login_attempts');
    console.log('All user and teacher data cleared');
  }

  async resetToDefaults() {
    this.clearAllData();
    this.initializeImages();
    await this.initializeDefaultTeacher();
    console.log('Database reset to defaults with encrypted passwords');
  }
}

// ============================================================================
// AUTH FLOW
// ============================================================================

class AuthFlow {
  constructor(db, elements) {
    this.db = db;
    this.elements = elements;
    this.currentSession = null;
    this.selectedImageId = null;
    this.ATTEMPTS_KEY = 'bteam_login_attempts';
    this.failedAttempts = this.loadFailedAttempts();
  }

  loadFailedAttempts() {
    const stored = localStorage.getItem(this.ATTEMPTS_KEY);
    return stored ? JSON.parse(stored) : {};
  }

  saveFailedAttempts() {
    localStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify(this.failedAttempts));
  }

  getFailedAttemptCount(userId) {
    const userAttempts = this.failedAttempts[userId];
    if (!userAttempts) return 0;
    
    // Reset if last attempt was more than 5 minutes ago
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() - userAttempts.lastAttempt > fiveMinutes) {
      delete this.failedAttempts[userId];
      this.saveFailedAttempts();
      return 0;
    }
    
    return userAttempts.count || 0;
  }

  recordFailedAttempt(userId) {
    if (!this.failedAttempts[userId]) {
      this.failedAttempts[userId] = { count: 0, lastAttempt: Date.now() };
    }
    this.failedAttempts[userId].count++;
    this.failedAttempts[userId].lastAttempt = Date.now();
    this.saveFailedAttempts();
  }

  clearFailedAttempts(userId) {
    delete this.failedAttempts[userId];
    this.saveFailedAttempts();
  }

  getDelayTime(attemptCount) {
    // Stricter delays: 10s, 20s, then permanent block
    const delays = [0, 10000, 20000, 60000]; // 0s, 10s, 20s, 1min (but will be blocked)
    const index = Math.min(attemptCount, delays.length - 1);
    return delays[index];
  }

  isUserBlocked(userId) {
    const userAttempts = this.failedAttempts[userId];
    if (!userAttempts) return false;
    
    // Block after 3 failed attempts
    return userAttempts.count >= 3;
  }

  async startAuthentication(userId) {
    const usernameError = Validator.validateUsername(userId);
    if (usernameError) {
      this.showError(usernameError);
      return;
    }

    const user = this.db.getUserById(userId.trim());
    if (!user) {
      this.showError("I don't know that name yet. Want to sign up first?");
      return;
    }

    // Check if user is blocked
    if (this.isUserBlocked(userId.trim())) {
      this.showError('Account locked! Too many failed attempts. Please ask your teacher to unlock your account.');
      return;
    }

    // Check for failed attempts and apply delay
    const attemptCount = this.getFailedAttemptCount(userId.trim());
    const delayTime = this.getDelayTime(attemptCount);
    
    if (delayTime > 0) {
      const seconds = Math.ceil(delayTime / 1000);
      this.showError(`Too many failed attempts. Please wait ${seconds} seconds...`);
      
      // Disable the start button temporarily
      const startBtn = document.getElementById('start-login-btn');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        startBtn.style.cursor = 'not-allowed';
      }
      
      await new Promise(resolve => setTimeout(resolve, delayTime));
      
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        startBtn.style.cursor = 'pointer';
      }
    }

    // Show all animals for selection
    const allImages = this.db.getAllImages();
    const imageGrid = allImages.sort(() => Math.random() - 0.5);

    this.currentSession = {
      userId: userId.trim(),
      storedHash: user.credentialsHash,
      selectedImageId: null,
      selectedColor: null,
      selectedNumber: null
    };

    this.elements.userInputContainer.classList.add('hidden');
    this.renderImageGrid(imageGrid);
  }

  renderImageGrid(images) {
    const grid = this.elements.imageGrid;
    grid.innerHTML = '';
    
    const privacyMode = localStorage.getItem('bteam_privacy_mode') === 'true';
    
    images.forEach(image => {
      const div = document.createElement('div');
      div.className = 'image-option' + (privacyMode ? ' privacy-mode' : '');
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('data-image-id', image.imageId);
      
      const img = document.createElement('img');
      img.src = `public/images/${image.fileName}`;
      img.alt = image.displayName;
      div.appendChild(img);

      // Label hidden until hover in privacy mode
      const label = document.createElement('p');
      label.className = 'image-label' + (privacyMode ? ' label-hidden' : '');
      label.textContent = image.displayName;
      div.appendChild(label);
      
      div.addEventListener('click', () => this.handleImageSelection(image.imageId));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleImageSelection(image.imageId);
        } else {
          this._handleGridArrowKey(e, grid);
        }
      });
      
      grid.appendChild(div);
    });
    
    this.elements.imageGridContainer.classList.remove('hidden');
    // Focus first item for keyboard users
    grid.querySelector('[tabindex="0"]')?.focus();
    AudioPrompts.speak('Find your special animal! Click on it.');
  }

  _handleGridArrowKey(e, grid) {
    const items = Array.from(grid.querySelectorAll('[role="button"]'));
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    const cols = 3;
    let next = -1;
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + cols;
    else if (e.key === 'ArrowUp') next = idx - cols;
    if (next >= 0 && next < items.length) {
      e.preventDefault();
      items[next].focus();
    }
  }

  handleImageSelection(imageId) {
    if (!this.currentSession) return;

    // Store the selected image
    this.currentSession.selectedImageId = imageId;
    this.selectedImageId = imageId;
    this.elements.imageGridContainer.classList.add('hidden');
    this.renderColorPrompt();
  }

  renderColorPrompt() {
    const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Black', 'White'];
    
    this.elements.propertyQuestion.textContent = "What's your favorite color?";
    
    const container = this.elements.propertyOptions;
    container.innerHTML = '';
    
    colors.forEach(color => {
      const button = document.createElement('button');
      button.className = 'property-btn';
      button.textContent = color;
      button.addEventListener('click', () => this.handleColorSelection(color));
      container.appendChild(button);
    });
    
    this.elements.propertyPromptContainer.classList.remove('hidden');
    AudioPrompts.speak("What is your favourite colour?");
  }

  handleColorSelection(color) {
    this.currentSession.selectedColor = color;
    this.elements.propertyPromptContainer.classList.add('hidden');
    this.renderNumberPrompt();
  }

  renderNumberPrompt() {
    this.elements.propertyQuestion.textContent = "What's your lucky number?";
    
    const container = this.elements.propertyOptions;
    container.innerHTML = '';
    
    // Create number input
    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'flex';
    inputContainer.style.gap = '10px';
    inputContainer.style.justifyContent = 'center';
    inputContainer.style.alignItems = 'center';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '100';
    input.placeholder = 'Enter 1-100';
    input.setAttribute('aria-label', 'Enter your lucky number between 1 and 100');
    input.style.padding = '12px';
    input.style.fontSize = '18px';
    input.style.width = '150px';
    input.style.borderRadius = '8px';
    input.style.border = '3px solid #FFE082';
    
    const button = document.createElement('button');
    button.className = 'property-btn';
    button.textContent = 'Login!';
    button.style.width = 'auto';
    button.addEventListener('click', () => {
      const num = parseInt(input.value);
      if (num >= 1 && num <= 100) {
        this.handleNumberSelection(num.toString());
      } else {
        this.showError('Pick a number between 1 and 100!');
      }
    });
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') button.click();
    });
    
    inputContainer.appendChild(input);
    inputContainer.appendChild(button);
    container.appendChild(inputContainer);
    
    this.elements.propertyPromptContainer.classList.remove('hidden');
    AudioPrompts.speak("What is your lucky number? Type it in.");
    input.focus();
  }

  async handleNumberSelection(number) {
    this.currentSession.selectedNumber = number;
    this.elements.propertyPromptContainer.classList.add('hidden');
    
    // Now verify all three selections against the stored hash
    await this.verifyCredentials();
  }

  async verifyCredentials() {
    if (!this.currentSession) return;

    const { selectedImageId, selectedColor, selectedNumber, storedHash, userId } = this.currentSession;
    
    const isValid = await CryptoUtils.verifyStudentCredentials(
      selectedImageId,
      selectedColor,
      selectedNumber,
      storedHash
    );
    
    if (isValid) {
      this.clearFailedAttempts(userId);
      SessionManager.create(userId, 'student');
      this.showAuthenticationResult(true, "Awesome! You got it right!");
    } else {
      this.recordFailedAttempt(userId);
      const attemptCount = this.getFailedAttemptCount(userId);
      AuditLog.log('LOGIN_FAILED', { userId, attemptCount });
      
      document.body.classList.add('login-failed-pulse');
      setTimeout(() => {
        document.body.classList.remove('login-failed-pulse');
      }, 1000);
      
      let message = "Oops! That's not the right combination. Try again!";
      if (attemptCount >= 3) {
        message = `Wrong! You've tried ${attemptCount} times. Be careful!`;
      }
      
      this.showAuthenticationResult(false, message);
    }
  }

  renderPropertyPrompt() {
    // This method is no longer used - keeping for compatibility
    // Login now uses renderColorPrompt -> renderNumberPrompt -> verifyCredentials
  }

  async handlePropertySelection(answer) {
    // This method is no longer used - keeping for compatibility
    // Login now collects all three pieces then verifies at once
  }

  showAuthenticationResult(success, message) {
    const result = this.elements.authResult;
    result.className = 'auth-result';
    result.classList.remove('hidden');
    
    if (success) {
      result.classList.add('success');
      result.innerHTML = `<div class="result-icon" aria-hidden="true">✅</div><h3>Success!</h3><p>${message}</p>`;
      AudioPrompts.speak('You got it right! Welcome!');
      setTimeout(() => this.elements.onAuthSuccess?.(), 2000);
    } else {
      document.body.classList.add('login-failed-pulse');
      setTimeout(() => document.body.classList.remove('login-failed-pulse'), 1000);
      
      result.classList.add('failure');
      result.innerHTML = `<div class="result-icon" aria-hidden="true">❌</div><h3>Try Again!</h3><p>${message}</p>
        <button type="button" id="retry-auth-btn" class="retry-button">Start Over</button>`;
      AudioPrompts.speak('Oops! That was not right. Try again!');
      result.querySelector('#retry-auth-btn')?.addEventListener('click', () => this.reset());
    }
  }

  showError(message) {
    const result = this.elements.authResult;
    result.className = 'auth-result error';
    result.classList.remove('hidden');
    result.innerHTML = `<div class="result-icon">⚠️</div><p>${message}</p>`;
  }

  reset() {
    this.currentSession = null;
    this.selectedImageId = null;
    this.elements.imageGridContainer.classList.add('hidden');
    this.elements.propertyPromptContainer.classList.add('hidden');
    this.elements.authResult.classList.add('hidden');
    this.elements.userInputContainer.classList.remove('hidden');
    this.elements.imageGrid.innerHTML = '';
    this.elements.propertyOptions.innerHTML = '';
  }
}

// ============================================================================
// REGISTRATION FLOW
// ============================================================================

class RegistrationFlow {
  constructor(db, elements) {
    this.db = db;
    this.elements = elements;
    this.availableImages = [];
    this.selectedImageId = null;
    this.selectedColor = null;
    this.selectedNumber = null;
    this.selectedTeacher = null;
    this.step = 1; // 1: pick animal, 2: pick color, 3: pick number, 4: pick teacher
  }

  loadAvailableImages() {
    this.availableImages = this.db.getAllImages();
    this.renderImageSelection(this.availableImages);
  }

  renderImageSelection(images) {
    const grid = this.elements.availableImages;
    grid.innerHTML = '';
    
    images.forEach(image => {
      const div = document.createElement('div');
      div.className = 'image-option';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('data-image-id', image.imageId);
      
      const img = document.createElement('img');
      img.src = `public/images/${image.fileName}`;
      img.alt = image.displayName;
      
      const label = document.createElement('p');
      label.className = 'image-label';
      label.textContent = image.displayName;
      
      div.appendChild(img);
      div.appendChild(label);
      
      div.addEventListener('click', () => this.handleImageSelection(image.imageId));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleImageSelection(image.imageId);
        } else {
          this._handleGridArrowKey(e, grid);
        }
      });
      
      grid.appendChild(div);
    });
    
    this.elements.availableImagesContainer.classList.remove('hidden');
    grid.querySelector('[tabindex="0"]')?.focus();
    AudioPrompts.speak('Pick your password animal! Use arrow keys or click.');
  }

  _handleGridArrowKey(e, grid) {
    const items = Array.from(grid.querySelectorAll('[role="button"]'));
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    const cols = 3;
    let next = -1;
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + cols;
    else if (e.key === 'ArrowUp') next = idx - cols;
    if (next >= 0 && next < items.length) {
      e.preventDefault();
      items[next].focus();
    }
  }

  handleImageSelection(imageId) {
    this.elements.availableImages.querySelector('.selected')?.classList.remove('selected');
    this.elements.availableImages.querySelector(`[data-image-id="${imageId}"]`)?.classList.add('selected');
    
    this.selectedImageId = imageId;
    this.step = 2;
    
    // Hide images, show color picker
    this.elements.availableImagesContainer.classList.add('hidden');
    this.showColorPicker();
  }

  showColorPicker() {
    const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Black', 'White'];
    
    this.elements.imagePropertiesPreview.classList.remove('hidden');
    const list = this.elements.propertiesList;
    list.innerHTML = '<dt><span class="step-number">Step 3:</span> <strong>Pick your favorite color for your PASSWORD:</strong></dt>';
    
    const colorContainer = document.createElement('dd');
    colorContainer.style.display = 'flex';
    colorContainer.style.flexWrap = 'wrap';
    colorContainer.style.gap = '10px';
    colorContainer.style.marginTop = '10px';
    
    colors.forEach(color => {
      const button = document.createElement('button');
      button.className = 'property-btn';
      button.textContent = color;
      button.style.minWidth = '100px';
      button.addEventListener('click', () => this.handleColorSelection(color));
      colorContainer.appendChild(button);
    });
    
    list.appendChild(colorContainer);
  }

  handleColorSelection(color) {
    this.selectedColor = color;
    this.step = 3;
    this.showNumberPicker();
  }

  showNumberPicker() {
    const list = this.elements.propertiesList;
    list.innerHTML = '<dt><span class="step-number">Step 4:</span> <strong>Pick your lucky number for your PASSWORD (1-100):</strong></dt>';
    
    const numberContainer = document.createElement('dd');
    numberContainer.style.marginTop = '10px';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '100';
    input.placeholder = 'Type a number...';
    input.style.padding = '10px';
    input.style.fontSize = '16px';
    input.style.width = '200px';
    input.style.marginRight = '10px';
    
    const button = document.createElement('button');
    button.className = 'property-btn';
    button.textContent = 'Next!';
    button.addEventListener('click', () => {
      const num = parseInt(input.value);
      if (num >= 1 && num <= 100) {
        this.handleNumberSelection(num.toString());
      } else {
        this.showError('Please pick a number between 1 and 100!');
      }
    });
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        button.click();
      }
    });
    
    numberContainer.appendChild(input);
    numberContainer.appendChild(button);
    list.appendChild(numberContainer);
    
    input.focus();
  }

  handleNumberSelection(number) {
    this.selectedNumber = number;
    this.step = 4;
    this.showTeacherPicker();
  }

  showTeacherPicker() {
    const teachers = this.db.getTeachers();
    const teacherList = Object.values(teachers);
    
    const list = this.elements.propertiesList;
    list.innerHTML = '<dt><span class="step-number">Step 5:</span> <strong>Who is your teacher?</strong></dt>';
    
    const teacherContainer = document.createElement('dd');
    teacherContainer.style.display = 'flex';
    teacherContainer.style.flexDirection = 'column';
    teacherContainer.style.gap = '10px';
    teacherContainer.style.marginTop = '10px';
    
    teacherList.forEach(teacher => {
      const button = document.createElement('button');
      button.className = 'property-btn';
      button.textContent = `${teacher.name}`;
      button.addEventListener('click', () => this.handleTeacherSelection(teacher.username));
      teacherContainer.appendChild(button);
    });
    
    // Add "No Teacher" option
    const noTeacherBtn = document.createElement('button');
    noTeacherBtn.className = 'property-btn';
    noTeacherBtn.textContent = 'Skip This Step';
    noTeacherBtn.style.opacity = '0.7';
    noTeacherBtn.addEventListener('click', () => this.handleTeacherSelection(null));
    teacherContainer.appendChild(noTeacherBtn);
    
    list.appendChild(teacherContainer);
  }

  handleTeacherSelection(teacherUsername) {
    this.selectedTeacher = teacherUsername;
    this.elements.imagePropertiesPreview.classList.add('hidden');
    this.showSummary();
  }

  showSummary() {
    const selectedImage = this.availableImages.find(img => img.imageId === this.selectedImageId);
    const teacherName = this.selectedTeacher ? this.db.getTeacherByUsername(this.selectedTeacher)?.name : 'None';
    
    this.elements.imagePropertiesPreview.classList.remove('hidden');
    const list = this.elements.propertiesList;
    list.innerHTML = `
      <dt><strong>Your USERNAME</strong></dt><dd class="summary-value">${this.elements.userIdInput.value}</dd>
      <dt><strong>Your PASSWORD is made of:</strong></dt>
      <dd class="summary-value">Animal: ${selectedImage.displayName}</dd>
      <dd class="summary-value">Color: ${this.selectedColor}</dd>
      <dd class="summary-value">Number: ${this.selectedNumber}</dd>
      <dt><strong>Your Teacher</strong></dt><dd class="summary-value">${teacherName}</dd>
    `;
    
    this.elements.submitRegistrationBtn.classList.remove('hidden');
  }

  async submitRegistration() {
    const userId = this.elements.userIdInput.value.trim();
    
    const usernameError = Validator.validateUsername(userId);
    if (usernameError) {
      this.showError(usernameError);
      this.elements.userIdInput.focus();
      this.elements.userIdInput.setAttribute('aria-invalid', 'true');
      return;
    }
    this.elements.userIdInput.setAttribute('aria-invalid', 'false');
    
    if (!this.selectedImageId || !this.selectedColor || !this.selectedNumber) {
      this.showError('Please complete all steps!');
      return;
    }

    try {
      await this.db.createUser(userId, this.selectedImageId, this.selectedColor, this.selectedNumber, this.selectedTeacher);
      this.showRegistrationResult(true, `Welcome, ${userId}! Your login is ready!`);
    } catch (error) {
      if (error.message === 'User already exists') {
        this.showError(`"${userId}" is already taken. Try a different name!`);
        this.elements.userIdInput.setAttribute('aria-invalid', 'true');
        this.elements.userIdInput.focus();
      } else {
        this.showError("Something went wrong. Let's try again!");
      }
    }
  }

  showRegistrationResult(success, message) {
    const result = this.elements.registrationResult;
    result.className = 'registration-result';
    result.classList.remove('hidden');
    
    if (success) {
      result.classList.add('success');
      result.innerHTML = `<div class="result-icon">✅</div><h3>All Set!</h3><p>${message}</p>
        <p class="help-text">Now you can log in with your animal!</p>`;
      setTimeout(() => this.elements.onRegistrationSuccess?.(), 3000);
    } else {
      result.classList.add('failure');
      result.innerHTML = `<div class="result-icon">❌</div><h3>Oops!</h3><p>${message}</p>
        <button type="button" id="retry-registration-btn" class="retry-button">Try Again</button>`;
      result.querySelector('#retry-registration-btn')?.addEventListener('click', () => this.reset());
    }
  }

  showError(message) {
    const result = this.elements.registrationResult;
    result.className = 'registration-result error';
    result.classList.remove('hidden');
    result.innerHTML = `<div class="result-icon">⚠️</div><p>${message}</p>`;
  }

  reset() {
    this.selectedImageId = null;
    this.selectedColor = null;
    this.selectedNumber = null;
    this.selectedTeacher = null;
    this.step = 1;
    this.elements.imagePropertiesPreview.classList.add('hidden');
    this.elements.submitRegistrationBtn.classList.add('hidden');
    this.elements.registrationResult.classList.add('hidden');
    this.elements.availableImages.querySelector('.selected')?.classList.remove('selected');
    this.elements.userIdInput.value = '';
    this.elements.propertiesList.innerHTML = '';
    this.loadAvailableImages();
  }
}

// ============================================================================
// MEMORY GAME
// ============================================================================

class MemoryGame {
  constructor(db) {
    this.db = db;
    this.cards = [];
    this.flippedCards = [];
    this.matchedPairs = 0;
    this.moves = 0;
    this.isProcessing = false;
    
    this.gameBoard = document.getElementById('game-board');
    this.movesDisplay = document.getElementById('game-moves');
    this.matchesDisplay = document.getElementById('game-matches');
    this.winMessage = document.getElementById('game-win-message');
    this.finalMovesDisplay = document.getElementById('final-moves');
    this.resetBtn = document.getElementById('game-reset-btn');
    
    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => this.startNewGame());
    }
  }

  startNewGame() {
    this.cards = [];
    this.flippedCards = [];
    this.matchedPairs = 0;
    this.moves = 0;
    this.isProcessing = false;
    
    if (this.winMessage) {
      this.winMessage.classList.add('hidden');
    }
    
    this.updateStats();
    this.createCards();
    this.renderBoard();
  }

  createCards() {
    // Get 6 random animals for the game
    const allImages = this.db.getAllImages();
    const selectedImages = this.shuffleArray([...allImages]).slice(0, 6);
    
    // Create pairs
    const cardPairs = [];
    selectedImages.forEach((image, index) => {
      cardPairs.push({ id: index * 2, imageId: image.imageId, image: image });
      cardPairs.push({ id: index * 2 + 1, imageId: image.imageId, image: image });
    });
    
    this.cards = this.shuffleArray(cardPairs);
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  renderBoard() {
    if (!this.gameBoard) return;
    
    this.gameBoard.innerHTML = '';
    
    this.cards.forEach((card) => {
      const cardElement = document.createElement('div');
      cardElement.className = 'game-card';
      cardElement.dataset.cardId = card.id;
      cardElement.dataset.imageId = card.imageId;
      
      cardElement.innerHTML = `
        <div class="card-front">❓</div>
        <div class="card-back">
          <img src="${card.image.path}" alt="${card.image.displayName}">
        </div>
      `;
      
      cardElement.addEventListener('click', () => this.handleCardClick(card.id));
      
      this.gameBoard.appendChild(cardElement);
    });
  }

  handleCardClick(cardId) {
    if (this.isProcessing) return;
    
    const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
    if (!cardElement || cardElement.classList.contains('flipped') || cardElement.classList.contains('matched')) {
      return;
    }
    
    cardElement.classList.add('flipped');
    this.flippedCards.push({ id: cardId, element: cardElement });
    
    if (this.flippedCards.length === 2) {
      this.moves++;
      this.updateStats();
      this.checkForMatch();
    }
  }

  checkForMatch() {
    this.isProcessing = true;
    
    const [card1, card2] = this.flippedCards;
    const imageId1 = card1.element.dataset.imageId;
    const imageId2 = card2.element.dataset.imageId;
    
    if (imageId1 === imageId2) {
      // Match found!
      setTimeout(() => {
        card1.element.classList.add('matched');
        card2.element.classList.add('matched');
        
        // Show celebration icon
        this.showMatchCelebration(card1.element);
        this.showMatchCelebration(card2.element);
        
        this.matchedPairs++;
        this.updateStats();
        this.flippedCards = [];
        this.isProcessing = false;
        
        if (this.matchedPairs === 6) {
          this.showWinMessage();
        }
      }, 500);
    } else {
      // No match
      setTimeout(() => {
        card1.element.classList.remove('flipped');
        card2.element.classList.remove('flipped');
        this.flippedCards = [];
        this.isProcessing = false;
      }, 1000);
    }
  }

  showMatchCelebration(cardElement) {
    // Create celebration icon
    const celebration = document.createElement('div');
    celebration.className = 'match-celebration';
    celebration.textContent = '✨';
    
    // Position it on the card
    const rect = cardElement.getBoundingClientRect();
    const boardRect = this.gameBoard.getBoundingClientRect();
    
    celebration.style.left = (rect.left - boardRect.left + rect.width / 2) + 'px';
    celebration.style.top = (rect.top - boardRect.top + rect.height / 2) + 'px';
    
    this.gameBoard.appendChild(celebration);
    
    // Remove after animation
    setTimeout(() => {
      celebration.remove();
    }, 1000);
  }

  updateStats() {
    if (this.movesDisplay) {
      this.movesDisplay.textContent = this.moves;
    }
    if (this.matchesDisplay) {
      this.matchesDisplay.textContent = `${this.matchedPairs}/6`;
    }
  }

  showWinMessage() {
    if (this.winMessage && this.finalMovesDisplay) {
      this.finalMovesDisplay.textContent = this.moves;
      this.winMessage.classList.remove('hidden');
    }
  }
}

// ============================================================================
// MAIN APP
// ============================================================================

class App {
  constructor() {
    this.db = new LocalDatabase();
    this.elements = this.getDOMElements();
    this.initializeFlows();
    this.setupEventListeners();
    // Wait for DB to be ready before checking session
    this.db.ready.then(() => this.checkExistingSession());
  }

  getDOMElements() {
    return {
      loginView: document.getElementById('login-view'),
      registrationView: document.getElementById('registration-view'),
      dashboardView: document.getElementById('dashboard-view'),
      teacherView: document.getElementById('teacher-view'),
      loginUserIdInput: document.getElementById('login-user-id'),
      startLoginBtn: document.getElementById('start-login-btn'),
      showTeacherLink: document.getElementById('show-teacher-link'),
      backToStudentLogin: document.getElementById('back-to-student-login'),
      imageGridContainer: document.getElementById('image-grid-container'),
      imageGrid: document.getElementById('image-grid'),
      propertyPromptContainer: document.getElementById('property-prompt-container'),
      propertyQuestion: document.getElementById('property-question'),
      propertyOptions: document.getElementById('property-options'),
      authResult: document.getElementById('auth-result'),
      registerUserIdInput: document.getElementById('register-user-id'),
      showLoginLink: document.getElementById('show-login-link'),
      availableImagesContainer: document.getElementById('available-images-container'),
      availableImages: document.getElementById('available-images'),
      imagePropertiesPreview: document.getElementById('image-properties-preview'),
      propertiesList: document.getElementById('properties-list'),
      submitRegistrationBtn: document.getElementById('submit-registration-btn'),
      registrationResult: document.getElementById('registration-result'),
      welcomeMessage: document.getElementById('welcome-message'),
      logoutBtn: document.getElementById('logout-btn')
    };
  }

  initializeFlows() {
    this.authFlow = new AuthFlow(this.db, {
      userInputContainer: this.elements.loginUserIdInput.parentElement,
      imageGridContainer: this.elements.imageGridContainer,
      imageGrid: this.elements.imageGrid,
      propertyPromptContainer: this.elements.propertyPromptContainer,
      propertyQuestion: this.elements.propertyQuestion,
      propertyOptions: this.elements.propertyOptions,
      authResult: this.elements.authResult,
      onAuthSuccess: () => this.showDashboard()
    });
    
    this.registrationFlow = new RegistrationFlow(this.db, {
      userIdInput: this.elements.registerUserIdInput,
      availableImagesContainer: this.elements.availableImagesContainer,
      availableImages: this.elements.availableImages,
      imagePropertiesPreview: this.elements.imagePropertiesPreview,
      propertiesList: this.elements.propertiesList,
      submitRegistrationBtn: this.elements.submitRegistrationBtn,
      registrationResult: this.elements.registrationResult,
      onRegistrationSuccess: () => this.showLogin()
    });
    
    this.teacherPortal = new TeacherPortal(this.db);
    this.memoryGame = new MemoryGame(this.db);
  }

  setupEventListeners() {
    this.elements.startLoginBtn.addEventListener('click', () => {
      this.authFlow.startAuthentication(this.elements.loginUserIdInput.value);
    });
    
    this.elements.loginUserIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.authFlow.startAuthentication(this.elements.loginUserIdInput.value);
      }
    });
    
    // Handle both the new button and old link (if it exists)
    const showRegisterBtn = document.getElementById('show-register-btn');
    const showRegisterLink = document.getElementById('show-register-link');
    
    if (showRegisterBtn) {
      showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.showRegistration();
      });
    }
    
    if (showRegisterLink) {
      showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.showRegistration();
      });
    }
    
    this.elements.showLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.showLogin();
    });
    
    this.elements.submitRegistrationBtn.addEventListener('click', () => {
      this.registrationFlow.submitRegistration();
    });
    
    this.elements.logoutBtn.addEventListener('click', () => {
      this.logout();
    });
    
    this.elements.showTeacherLink?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showTeacherPortal();
    });
    
    this.elements.backToStudentLogin?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showLogin();
    });
    
    // Navigation menu links
    document.getElementById('home-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showLogin();
    });
    
    document.getElementById('nav-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeMenu();
      this.showLogin();
    });
    
    document.getElementById('nav-register')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeMenu();
      this.showRegistration();
    });
    
    document.getElementById('nav-teacher')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeMenu();
      this.showTeacherPortal();
    });
    
    // Hamburger menu
    document.getElementById('hamburger-menu')?.addEventListener('click', () => {
      this.openMenu();
    });
    
    document.getElementById('close-menu')?.addEventListener('click', () => {
      this.closeMenu();
    });
    
    // Close menu when clicking overlay
    document.getElementById('menu-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'menu-overlay') {
        this.closeMenu();
      }
    });
    
    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeMenu();
      }
    });
    
    // Secret: Press Ctrl+Shift+R to reset database
    document.addEventListener('keydown', async (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (confirm('Reset all data and start fresh with encrypted passwords?\n\nThis will:\n- Delete all student accounts\n- Reset teacher password to: teacher123\n- Clear all login attempts\n\nThis cannot be undone!')) {
          await this.db.resetToDefaults();
          alert('Database reset complete! All passwords are now encrypted.\n\nTeacher login:\nUsername: teacher\nPassword: teacher123');
          this.logout();
          this.showLogin();
        }
      }
    });
  }

  openMenu() {
    const overlay = document.getElementById('menu-overlay');
    const hamburger = document.getElementById('hamburger-menu');
    if (overlay) {
      overlay.classList.remove('hidden');
      hamburger?.setAttribute('aria-expanded', 'true');
    }
  }

  closeMenu() {
    const overlay = document.getElementById('menu-overlay');
    const hamburger = document.getElementById('hamburger-menu');
    if (overlay) {
      overlay.classList.add('hidden');
      hamburger?.setAttribute('aria-expanded', 'false');
    }
  }

  checkExistingSession() {
    const session = SessionManager.get();
    if (session) {
      if (session.role === 'teacher') {
        const teacher = this.db.getTeacherByUsername(session.userId);
        if (teacher) {
          this.teacherPortal.currentTeacher = teacher;
          this.showTeacherPortal();
          this.teacherPortal.showDashboard();
        } else {
          SessionManager.destroy();
          this.showLogin();
        }
      } else {
        this.showDashboard();
      }
    } else {
      this.showLogin();
    }

    window.addEventListener('session-timeout', (e) => {
      this._showTimeoutBanner(e.detail?.role);
      this.logout(true);
    });

    ['click', 'keydown', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, () => SessionManager.touch(), { passive: true });
    });
  }

  _showTimeoutBanner(role) {
    const banner = document.createElement('div');
    banner.className = 'timeout-banner';
    banner.innerHTML = `<span>⏱️ You were logged out due to inactivity.</span>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }

  showLogin() {
    this.hideAllViews();
    this.authFlow.reset();
    this.elements.loginView.classList.remove('hidden');
    this.elements.loginUserIdInput.focus();
    this.updateNavigation('login');
  }

  showRegistration() {
    this.hideAllViews();
    this.registrationFlow.reset();
    this.elements.registrationView.classList.remove('hidden');
    this.registrationFlow.loadAvailableImages();
    this.elements.registerUserIdInput.focus();
    this.updateNavigation('register');
  }

  showDashboard() {
    this.hideAllViews();
    const session = SessionManager.get();
    const userId = session?.userId;
    this.elements.welcomeMessage.textContent = userId ? `Welcome back, ${userId}! 👋` : 'Welcome! 👋';

    // Show last login info
    const lastLogin = userId ? SessionManager.getLastLogin(userId) : null;
    const lastLoginEl = document.getElementById('last-login-info');
    if (lastLoginEl && lastLogin) {
      const prev = new Date(lastLogin);
      // Only show if there's a previous session (not the current one)
      const session = SessionManager.get();
      if (session && session.loginTime !== lastLogin) {
        lastLoginEl.textContent = `Last login: ${prev.toLocaleString()}`;
        lastLoginEl.classList.remove('hidden');
      }
    }

    this.elements.dashboardView.classList.remove('hidden');
    if (this.memoryGame) {
      this.memoryGame.startNewGame();
    }
    this.updateNavigation('dashboard');
  }

  hideAllViews() {
    this.elements.loginView.classList.add('hidden');
    this.elements.registrationView.classList.add('hidden');
    this.elements.dashboardView.classList.add('hidden');
    this.elements.teacherView?.classList.add('hidden');
  }

  showTeacherPortal() {
    this.hideAllViews();
    this.elements.teacherView.classList.remove('hidden');
    this.updateNavigation('teacher');
  }

  updateNavigation(currentView) {
    // Update active state on navigation links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
    });
    
    if (currentView === 'login' || currentView === 'dashboard') {
      document.getElementById('nav-login')?.classList.add('active');
    } else if (currentView === 'register') {
      document.getElementById('nav-register')?.classList.add('active');
    } else if (currentView === 'teacher') {
      document.getElementById('nav-teacher')?.classList.add('active');
    }
  }

  logout(timedOut = false) {
    SessionManager.destroy(timedOut ? 'SESSION_TIMEOUT' : 'LOGOUT');
    this.showLogin();
  }

  clearSession() {
    SessionManager.destroy();
  }
}

// ============================================================================
// AUDIO PROMPTS
// ============================================================================

class AudioPrompts {
  static speak(text, priority = 'polite') {
    if (localStorage.getItem('bteam_accessibility_settings')) {
      try {
        const s = JSON.parse(localStorage.getItem('bteam_accessibility_settings'));
        if (s.audio !== 'on') return;
      } catch { return; }
    } else {
      return; // default off
    }
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.9;
    utt.pitch = 1.1;
    window.speechSynthesis.speak(utt);
  }
}

// ============================================================================
// ACCESSIBILITY SETTINGS
// ============================================================================

class AccessibilitySettings {
  constructor() {
    this.SETTINGS_KEY = 'bteam_accessibility_settings';
    this.settings = this.loadSettings();
    this.applySettings();
    this.setupEventListeners();
  }

  loadSettings() {
    const saved = localStorage.getItem(this.SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {
      theme: 'auto',
      textSize: 'normal',
      animations: 'on',
      contrast: 'normal',
      font: 'default',
      audio: 'off'
    };
  }

  saveSettings() {
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(this.settings));
  }

  applySettings() {
    const body = document.body;
    
    body.classList.remove('theme-dark', 'theme-light', 'theme-auto');
    body.classList.remove('text-small', 'text-normal', 'text-large', 'text-xlarge');
    body.classList.remove('animations-on', 'animations-off');
    body.classList.remove('contrast-normal', 'contrast-high');
    body.classList.remove('font-default', 'font-dyslexia');
    
    if (this.settings.theme !== 'auto') {
      body.classList.add(`theme-${this.settings.theme}`);
    }
    body.classList.add(`text-${this.settings.textSize}`);
    body.classList.add(`animations-${this.settings.animations}`);
    body.classList.add(`contrast-${this.settings.contrast}`);
    body.classList.add(`font-${this.settings.font || 'default'}`);
  }

  setupEventListeners() {
    // Toggle panel
    const toggleBtn = document.getElementById('accessibility-toggle');
    const panel = document.getElementById('accessibility-panel');
    const closeBtn = document.getElementById('close-accessibility');
    
    toggleBtn?.addEventListener('click', () => {
      panel.classList.toggle('hidden');
    });
    
    closeBtn?.addEventListener('click', () => {
      panel.classList.add('hidden');
    });
    
    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
      }
    });
    
    // Theme buttons
    ['light', 'dark', 'auto'].forEach(theme => {
      const btn = document.getElementById(`theme-${theme}`);
      btn?.addEventListener('click', () => {
        this.setSetting('theme', theme);
        this.updateActiveButton('theme', theme);
      });
    });
    
    // Text size buttons
    ['small', 'normal', 'large', 'xlarge'].forEach(size => {
      const btn = document.getElementById(`text-${size}`);
      btn?.addEventListener('click', () => {
        this.setSetting('textSize', size);
        this.updateActiveButton('text', size);
      });
    });
    
    // Animation buttons
    ['on', 'off'].forEach(state => {
      const btn = document.getElementById(`animations-${state}`);
      btn?.addEventListener('click', () => {
        this.setSetting('animations', state);
        this.updateActiveButton('animations', state);
      });
    });
    
    // Contrast buttons
    ['normal', 'high'].forEach(level => {
      const btn = document.getElementById(`contrast-${level}`);
      btn?.addEventListener('click', () => {
        this.setSetting('contrast', level);
        this.updateActiveButton('contrast', level);
      });
    });
    
    // Font buttons
    ['default', 'dyslexia'].forEach(font => {
      const btn = document.getElementById(`font-${font}`);
      btn?.addEventListener('click', () => {
        this.setSetting('font', font);
        this.updateActiveButton('font', font);
      });
    });

    // Audio prompt buttons
    ['off', 'on'].forEach(state => {
      const btn = document.getElementById(`audio-${state}`);
      btn?.addEventListener('click', () => {
        this.setSetting('audio', state);
        this.updateActiveButton('audio', state);
        if (state === 'on') AudioPrompts.speak('Audio prompts are now on!');
      });
    });

    // Reset button
    const resetBtn = document.getElementById('reset-settings');
    resetBtn?.addEventListener('click', () => {
      this.resetSettings();
    });

    // Privacy mode toggle
    const privacyBtn = document.getElementById('privacy-mode-btn');
    privacyBtn?.addEventListener('click', () => {
      const current = localStorage.getItem('bteam_privacy_mode') === 'true';
      const next = !current;
      localStorage.setItem('bteam_privacy_mode', String(next));
      document.body.classList.toggle('privacy-mode', next);
      privacyBtn.classList.toggle('active', next);
      privacyBtn.textContent = next ? '🙈 Privacy Mode: On' : '👁️ Privacy Mode: Off';
    });

    // Init privacy mode state
    const privacyActive = localStorage.getItem('bteam_privacy_mode') === 'true';
    document.body.classList.toggle('privacy-mode', privacyActive);
    if (privacyBtn) {
      privacyBtn.classList.toggle('active', privacyActive);
      privacyBtn.textContent = privacyActive ? '🙈 Privacy Mode: On' : '👁️ Privacy Mode: Off';
    }
    
    // Initialize active buttons
    this.updateActiveButton('theme', this.settings.theme);
    this.updateActiveButton('text', this.settings.textSize);
    this.updateActiveButton('animations', this.settings.animations);
    this.updateActiveButton('contrast', this.settings.contrast);
    this.updateActiveButton('font', this.settings.font || 'default');
    this.updateActiveButton('audio', this.settings.audio || 'off');
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.saveSettings();
    this.applySettings();
  }

  updateActiveButton(group, value) {
    // Remove active class from all buttons in group
    document.querySelectorAll(`[data-${group}]`).forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active class to selected button
    const activeBtn = document.querySelector(`[data-${group}="${value}"]`);
    activeBtn?.classList.add('active');
  }

  resetSettings() {
    this.settings = {
      theme: 'auto',
      textSize: 'normal',
      animations: 'on',
      contrast: 'normal',
      font: 'default',
      audio: 'off'
    };
    this.saveSettings();
    this.applySettings();
    
    this.updateActiveButton('theme', 'auto');
    this.updateActiveButton('text', 'normal');
    this.updateActiveButton('animations', 'on');
    this.updateActiveButton('contrast', 'normal');
    this.updateActiveButton('font', 'default');
    this.updateActiveButton('audio', 'off');
  }
}

// Initialize accessibility settings when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new AccessibilitySettings());
} else {
  new AccessibilitySettings();
}


// ============================================================================
// TEACHER PORTAL
// ============================================================================

class TeacherPortal {
  constructor(db) {
    this.db = db;
    this.currentTeacher = null;
    console.log('TeacherPortal initialized');
    
    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
    } else {
      // DOM is already ready
      setTimeout(() => this.setupEventListeners(), 200);
    }
  }

  setupEventListeners() {
    console.log('Setting up teacher event listeners');
    
    const loginBtn = document.getElementById('teacher-login-btn');
    const logoutBtn = document.getElementById('teacher-logout-btn');
    const usernameInput = document.getElementById('teacher-username');
    const passwordInput = document.getElementById('teacher-password');

    console.log('Teacher elements found:', {
      loginBtn: !!loginBtn,
      logoutBtn: !!logoutBtn,
      usernameInput: !!usernameInput,
      passwordInput: !!passwordInput
    });

    if (!loginBtn) {
      console.error('Teacher login button not found!');
      return;
    }

    // Remove any existing listeners by cloning
    const newLoginBtn = loginBtn.cloneNode(true);
    loginBtn.parentNode.replaceChild(newLoginBtn, loginBtn);

    newLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Login button clicked!');
      const username = usernameInput?.value.trim() || '';
      const password = passwordInput?.value.trim() || '';
      console.log('Attempting login with username:', username);
      this.login(username, password);
    });

    passwordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const username = usernameInput?.value.trim() || '';
        const password = passwordInput?.value.trim() || '';
        this.login(username, password);
      }
    });

    logoutBtn?.addEventListener('click', () => {
      this.logout();
    });
    
    console.log('Teacher event listeners setup complete');
  }

  async login(username, password) {
    // Ensure default teacher is seeded before attempting login
    await this.db.ready;

    console.log('=== LOGIN ATTEMPT ===');
    console.log('Username:', username);
    console.log('Password length:', password?.length);
    
    // Clear any previous errors
    const resultDiv = document.getElementById('teacher-login-result');
    if (resultDiv) {
      resultDiv.classList.add('hidden');
    }
    
    // Validate inputs
    const usernameError = Validator.validateTeacherUsername(username);
    if (usernameError) {
      this.showLoginError(usernameError);
      return;
    }
    const passwordError = Validator.validateTeacherPassword(password);
    if (passwordError) {
      this.showLoginError(passwordError);
      return;
    }
    
    // Get teacher from database
    const teacher = this.db.getTeacherByUsername(username);
    console.log('Teacher lookup result:', teacher ? 'Found' : 'Not found');
    
    if (!teacher) {
      console.log('Teacher not found');
      this.showLoginError('Username not found');
      return;
    }
    
    // Verify password using SHA-256
    console.log('Verifying password...');
    const isValid = await CryptoUtils.verifyPassword(password, teacher.passwordHash);
    console.log('Password valid:', isValid);
    
    if (!isValid) {
      console.log('Password incorrect');
      this.showLoginError('Incorrect password');
      return;
    }

    // Login successful
    console.log('Login successful!');
    this.currentTeacher = teacher;
    SessionManager.create(username, 'teacher');
    this.showDashboard();
  }

  showLoginError(message) {
    console.log('Showing error:', message);
    const result = document.getElementById('teacher-login-result');
    if (!result) {
      console.error('teacher-login-result element not found!');
      alert(message); // Fallback
      return;
    }
    result.className = 'auth-result error';
    result.classList.remove('hidden');
    result.innerHTML = `<div class="result-icon">⚠️</div><p>${message}</p>`;
  }

  showDashboard() {
    console.log('=== SHOWING DASHBOARD ===');
    const loginForm = document.getElementById('teacher-login-form');
    const dashboard = document.getElementById('teacher-dashboard');
    const welcome = document.getElementById('teacher-welcome');
    
    console.log('Dashboard elements:', {
      loginForm: !!loginForm,
      dashboard: !!dashboard,
      welcome: !!welcome
    });
    
    if (!loginForm || !dashboard) {
      console.error('Required dashboard elements not found!');
      alert('Error: Dashboard elements not found');
      return;
    }
    
    loginForm.classList.add('hidden');
    dashboard.classList.remove('hidden');
    
    if (welcome) {
      welcome.textContent = `Welcome, ${this.currentTeacher.name}! 👨‍🏫`;
    }
    
    console.log('Loading students...');
    this.loadStudents();
    this.renderAuditLog();
  }

  loadStudents(filterQuery = '', showLockedOnly = false) {
    const allStudents = this.db.getUsersByTeacher(this.currentTeacher.username);
    const studentList = document.getElementById('student-list');
    const studentSection = studentList?.closest('.teacher-actions');

    // Inject search/filter controls once
    if (!document.getElementById('student-search')) {
      const controls = document.createElement('div');
      controls.className = 'student-controls';
      controls.innerHTML = `
        <input type="search" id="student-search" class="student-search-input"
          placeholder="Search students..." aria-label="Search students"
          value="${filterQuery}">
        <label class="filter-label">
          <input type="checkbox" id="filter-locked" ${showLockedOnly ? 'checked' : ''}>
          Show locked only
        </label>
        <span id="student-count" class="student-count"></span>
      `;
      studentList.before(controls);

      document.getElementById('student-search').addEventListener('input', (e) => {
        const locked = document.getElementById('filter-locked')?.checked || false;
        this.loadStudents(e.target.value, locked);
      });
      document.getElementById('filter-locked').addEventListener('change', (e) => {
        const q = document.getElementById('student-search')?.value || '';
        this.loadStudents(q, e.target.checked);
      });
    } else {
      // Update existing controls
      document.getElementById('student-search').value = filterQuery;
      document.getElementById('filter-locked').checked = showLockedOnly;
    }

    // Filter students
    const q = filterQuery.toLowerCase();
    let students = allStudents.filter(s =>
      !q || s.userId.toLowerCase().includes(q)
    );
    if (showLockedOnly) {
      students = students.filter(s => this.db.isUserLocked(s.userId));
    }

    const countEl = document.getElementById('student-count');
    if (countEl) countEl.textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;

    if (allStudents.length === 0) {
      studentList.innerHTML = '<p class="help-text">No students linked to your account yet.</p>';
      return;
    }

    if (students.length === 0) {
      studentList.innerHTML = '<p class="help-text">No students match your search.</p>';
      return;
    }

    studentList.innerHTML = '';
    students.forEach(student => {
      const isLocked = this.db.isUserLocked(student.userId);
      const failedCount = this.db.getFailedAttemptCount(student.userId);
      const teacherName = student.teacherUsername
        ? (this.db.getTeacherByUsername(student.teacherUsername)?.name || student.teacherUsername)
        : 'None';

      const card = document.createElement('div');
      card.className = 'student-card' + (isLocked ? ' student-card--locked' : '');
      card.setAttribute('role', 'article');
      card.setAttribute('aria-label', `Student: ${student.userId}`);

      card.innerHTML = `
        <div class="student-info">
          <h4>${this._escapeHtml(student.userId)}</h4>
          ${isLocked ? '<p class="lock-status" role="alert">🔒 Locked — too many failed attempts</p>' : ''}
          ${failedCount > 0 && !isLocked ? `<p class="failed-count">⚠️ ${failedCount} failed attempt${failedCount !== 1 ? 's' : ''}</p>` : ''}
          <p class="help-text">Teacher: <strong>${this._escapeHtml(teacherName)}</strong></p>
          <p class="help-text">Created: ${new Date(student.createdAt).toLocaleDateString()}</p>
        </div>
        <div class="student-actions">
          ${isLocked ? `<button class="action-btn unlock-btn-small" data-user="${this._escapeHtml(student.userId)}" aria-label="Unlock ${this._escapeHtml(student.userId)}">Unlock</button>` : ''}
          <button class="action-btn reset-btn-small" data-user="${this._escapeHtml(student.userId)}" aria-label="Reset password for ${this._escapeHtml(student.userId)}">Reset Password</button>
          <button class="action-btn delete-btn-small" data-user="${this._escapeHtml(student.userId)}" aria-label="Delete ${this._escapeHtml(student.userId)}">Delete</button>
        </div>
      `;
      studentList.appendChild(card);
    });

    studentList.querySelectorAll('.unlock-btn-small').forEach(btn => {
      btn.addEventListener('click', () => this.unlockStudent(btn.dataset.user));
    });
    studentList.querySelectorAll('.reset-btn-small').forEach(btn => {
      btn.addEventListener('click', () => this.resetStudentPassword(btn.dataset.user));
    });
    studentList.querySelectorAll('.delete-btn-small').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm(`Delete student "${btn.dataset.user}"? This cannot be undone.`)) {
          this.deleteStudent(btn.dataset.user);
        }
      });
    });
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  unlockStudent(userId) {
    this.db.unlockUser(userId, this.currentTeacher?.username);
    const q = document.getElementById('student-search')?.value || '';
    const locked = document.getElementById('filter-locked')?.checked || false;
    this.loadStudents(q, locked);
  }  resetStudentPassword(userId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Reset Password for ${userId}</h3>
        <p class="help-text">Select new credentials for the student</p>
        
        <div id="reset-animal-grid" class="image-grid"></div>
        
        <div id="reset-color-picker" class="hidden">
          <h4>Pick new favorite color:</h4>
          <div id="reset-color-buttons" class="button-group"></div>
        </div>
        
        <div id="reset-number-picker" class="hidden">
          <h4>Pick new lucky number:</h4>
          <input type="number" id="reset-number-input" min="1" max="100" placeholder="1-100">
          <button id="reset-number-confirm" class="property-btn">Continue</button>
        </div>
        
        <div id="reset-password-display" class="hidden password-display">
          <h4>✅ Password Reset Successful!</h4>
          <p class="help-text">Share these credentials with the student. They will disappear in <span id="countdown">10</span> seconds.</p>
          <div class="password-info">
            <p><strong>🐾 Animal:</strong> <span id="display-animal"></span></p>
            <p><strong>🎨 Color:</strong> <span id="display-color"></span></p>
            <p><strong>🔢 Number:</strong> <span id="display-number"></span></p>
          </div>
        </div>
        
        <div class="modal-actions">
          <button id="cancel-reset" class="action-btn">Cancel</button>
          <button id="confirm-reset" class="action-btn hidden">Save Changes</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    let newImageId, newColor, newNumber;
    
    // Show animal selection
    const images = this.db.getAllImages();
    const grid = modal.querySelector('#reset-animal-grid');
    images.forEach(image => {
      const div = document.createElement('div');
      div.className = 'image-option';
      div.innerHTML = `<img src="public/images/${image.fileName}" alt="${image.displayName}">
                       <p class="image-label">${image.displayName}</p>`;
      div.addEventListener('click', () => {
        grid.querySelectorAll('.image-option').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        newImageId = image.imageId;
        modal.querySelector('#reset-animal-grid').classList.add('hidden');
        modal.querySelector('#reset-color-picker').classList.remove('hidden');
        
        // Show color picker
        const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Black', 'White'];
        const colorButtons = modal.querySelector('#reset-color-buttons');
        colors.forEach(color => {
          const btn = document.createElement('button');
          btn.className = 'property-btn';
          btn.textContent = color;
          btn.addEventListener('click', () => {
            newColor = color;
            modal.querySelector('#reset-color-picker').classList.add('hidden');
            modal.querySelector('#reset-number-picker').classList.remove('hidden');
          });
          colorButtons.appendChild(btn);
        });
      });
      grid.appendChild(div);
    });
    
    // Number confirmation
    modal.querySelector('#reset-number-confirm')?.addEventListener('click', () => {
      const num = parseInt(modal.querySelector('#reset-number-input').value);
      if (num >= 1 && num <= 100) {
        newNumber = num.toString();
        modal.querySelector('#reset-number-picker').classList.add('hidden');
        modal.querySelector('#confirm-reset').classList.remove('hidden');
      }
    });
    
    // Confirm reset
    modal.querySelector('#confirm-reset')?.addEventListener('click', () => {
      try {
        this.db.updateUserCredentials(userId, newImageId, newColor, newNumber, this.currentTeacher?.username);
        
        // Hide the form buttons
        modal.querySelector('.modal-actions').classList.add('hidden');
        
        // Get the animal name for display
        const selectedImage = images.find(img => img.imageId === newImageId);
        
        // Show the password display
        const displayDiv = modal.querySelector('#reset-password-display');
        modal.querySelector('#display-animal').textContent = selectedImage.displayName;
        modal.querySelector('#display-color').textContent = newColor;
        modal.querySelector('#display-number').textContent = newNumber;
        displayDiv.classList.remove('hidden');
        
        // Start countdown
        let timeLeft = 10;
        const countdownSpan = modal.querySelector('#countdown');
        const countdownInterval = setInterval(() => {
          timeLeft--;
          countdownSpan.textContent = timeLeft;
          if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            modal.remove();
            const q = document.getElementById('student-search')?.value || '';
            const locked = document.getElementById('filter-locked')?.checked || false;
            this.loadStudents(q, locked);
          }
        }, 1000);
        
      } catch (error) {
        alert('Error resetting password: ' + error.message);
      }
    });
    
    // Cancel
    modal.querySelector('#cancel-reset')?.addEventListener('click', () => {
      modal.remove();
    });
  }

  deleteStudent(userId) {
    try {
      this.db.deleteUser(userId, this.currentTeacher?.username);
      const q = document.getElementById('student-search')?.value || '';
      const locked = document.getElementById('filter-locked')?.checked || false;
      this.loadStudents(q, locked);
    } catch (error) {
      alert('Error deleting student: ' + error.message);
    }
  }

  renderAuditLog() {
    const dashboard = document.getElementById('teacher-dashboard');
    if (!dashboard) return;

    // Remove existing audit section if re-rendering
    dashboard.querySelector('.audit-log-section')?.remove();

    const section = document.createElement('div');
    section.className = 'audit-log-section teacher-actions';
    section.innerHTML = `
      <h3>Audit Log</h3>
      <div class="audit-controls">
        <button id="audit-refresh-btn" class="action-btn">Refresh</button>
        <button id="audit-clear-btn" class="action-btn delete-btn-small">Clear Log</button>
      </div>
      <div id="audit-log-entries" class="audit-log-entries"></div>
    `;
    dashboard.insertBefore(section, document.getElementById('teacher-logout-btn'));

    section.querySelector('#audit-refresh-btn').addEventListener('click', () => this.renderAuditLog());
    section.querySelector('#audit-clear-btn').addEventListener('click', () => {
      if (confirm('Clear all audit log entries?')) {
        AuditLog.clear();
        this.renderAuditLog();
      }
    });

    this._populateAuditEntries();
  }

  _populateAuditEntries() {
    const container = document.getElementById('audit-log-entries');
    if (!container) return;
    const entries = AuditLog.getRecent(100);
    if (entries.length === 0) {
      container.innerHTML = '<p class="help-text">No audit entries yet.</p>';
      return;
    }
    const ACTION_ICONS = {
      LOGIN: '🔓', LOGOUT: '🔒', SESSION_TIMEOUT: '⏱️',
      LOGIN_FAILED: '❌', USER_CREATED: '➕', USER_DELETED: '🗑️',
      PASSWORD_RESET: '🔑', ACCOUNT_UNLOCKED: '🔓'
    };
    container.innerHTML = entries.map(e => {
      const icon = ACTION_ICONS[e.action] || '📋';
      const time = new Date(e.timestamp).toLocaleString();
      const detail = e.userId ? `<span class="audit-user">${e.userId}</span>` : '';
      const extra = e.performedBy ? ` by <span class="audit-user">${e.performedBy}</span>` : '';
      const attempts = e.attemptCount ? ` (attempt ${e.attemptCount})` : '';
      return `<div class="audit-entry audit-${e.action.toLowerCase().replace('_','-')}">
        <span class="audit-icon">${icon}</span>
        <span class="audit-action">${e.action}</span>
        ${detail}${extra}${attempts}
        <span class="audit-time">${time}</span>
      </div>`;
    }).join('');
  }

  logout() {
    AuditLog.log('LOGOUT', { userId: this.currentTeacher?.username, role: 'teacher' });
    this.currentTeacher = null;
    SessionManager.destroy('LOGOUT');
    document.getElementById('teacher-login-form').classList.remove('hidden');
    document.getElementById('teacher-dashboard').classList.add('hidden');
    document.getElementById('teacher-username').value = '';
    document.getElementById('teacher-password').value = '';
    document.getElementById('teacher-login-result').classList.add('hidden');
  }
}


// ============================================================================
// INITIALIZE APPLICATION
// ============================================================================

console.log('=== B-Team Login System Starting ===');

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  console.log('Waiting for DOM to load...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    try {
      new App();
      console.log('App initialized successfully');
    } catch (error) {
      console.error('Error initializing app:', error);
    }
  });
} else {
  console.log('DOM already loaded, initializing app...');
  try {
    new App();
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
  }
}

export default App;


// ============================================================================
// EASTER EGGS - Fun Interactive Elements
// ============================================================================

class EasterEggs {
  constructor() {
    this.rainbowMode = false;
    this.setupStars();
    this.setupRainbowMode();
    this.setupClickEffects();
  }

  setupStars() {
    const container = document.getElementById('star-container');
    if (!container) return;

    // Create clickable stars that appear randomly
    setInterval(() => {
      if (Math.random() > 0.8) { // 20% chance
        const star = document.createElement('div');
        star.className = 'clickable-star';
        star.textContent = '★';
        star.style.left = Math.random() * 90 + '%';
        star.style.top = Math.random() * 80 + '%';
        
        star.addEventListener('click', (e) => {
          // Create sparkle effect
          for (let i = 0; i < 5; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'sparkle';
            sparkle.style.left = e.clientX + 'px';
            sparkle.style.top = e.clientY + 'px';
            sparkle.style.setProperty('--angle', (i * 72) + 'deg');
            document.body.appendChild(sparkle);
            setTimeout(() => sparkle.remove(), 1000);
          }
          e.target.remove();
        });
        
        container.appendChild(star);
        
        // Remove after 5 seconds if not clicked
        setTimeout(() => {
          if (star.parentNode) star.remove();
        }, 5000);
      }
    }, 2000);
  }

  setupRainbowMode() {
    const btn = document.getElementById('rainbow-mode-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      this.rainbowMode = !this.rainbowMode;
      document.body.classList.toggle('rainbow-mode', this.rainbowMode);
      
      if (this.rainbowMode) {
        btn.textContent = '🌈';
        this.showMessage('Rainbow Mode Activated!');
      } else {
        btn.textContent = '?';
        this.showMessage('Rainbow Mode Off');
      }
    });
  }

  setupClickEffects() {
    // Add ripple effect to any click
    document.addEventListener('click', (e) => {
      if (Math.random() > 0.5) { // 50% chance
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = e.clientX + 'px';
        ripple.style.top = e.clientY + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }
    });

    // Secret: Triple-click header for confetti
    const header = document.querySelector('header h1');
    let clickCount = 0;
    let clickTimer;
    
    if (header) {
      header.addEventListener('click', () => {
        clickCount++;
        clearTimeout(clickTimer);
        
        if (clickCount === 3) {
          this.triggerConfetti();
          clickCount = 0;
        }
        
        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 1000);
      });
    }
  }

  triggerConfetti() {
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.backgroundColor = this.getRandomColor();
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 3000);
      }, i * 30);
    }
    this.showMessage('Confetti!');
  }

  getRandomColor() {
    const colors = ['#FF6B9D', '#4CAF50', '#2196F3', '#FFC107', '#9C27B0', '#FF5722'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  showMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'easter-egg-message';
    msg.textContent = text;
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 2000);
  }
}

// Initialize easter eggs when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new EasterEggs());
} else {
  new EasterEggs();
}
