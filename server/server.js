import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHTTPSServer, shouldUseHTTPS } from './config/https.js';
import registrationRoutes from './routes/registration.js';
import { Database } from './data/repositories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize database
const db = new Database();
await db.connect();
await db.initializeSchema();
await db.seedImages();
console.log('Database initialized successfully');

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'graphical-auth-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 3600000, // 1 hour
    sameSite: 'strict'
  },
  name: 'sessionId' // Custom session cookie name
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve client files from client directory
app.use('/client', express.static(path.join(__dirname, '../client')));

// Request logging middleware (development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes will be mounted here
// TODO: Mount authentication routes
// app.use('/auth', authRoutes);
// Mount registration routes
app.use('/registration', registrationRoutes);
// TODO: Mount session routes
// app.use('/session', sessionRoutes);

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  // Log error details (in production, use proper logging service)
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Send error response (sanitized for production)
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Start server
let server;

if (shouldUseHTTPS()) {
  // Production: Use HTTPS
  const httpsServer = createHTTPSServer(app);
  if (httpsServer) {
    server = httpsServer.listen(PORT, () => {
      console.log(`HTTPS server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('HTTPS/TLS: enabled');
    });
  } else {
    console.error('Failed to create HTTPS server. Falling back to HTTP.');
    server = app.listen(PORT, () => {
      console.log(`HTTP server running on port ${PORT} (HTTPS configuration failed)`);
    });
  }
} else {
  // Development: Use HTTP
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`HTTPS/TLS: ${process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled (development)'}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default app;
