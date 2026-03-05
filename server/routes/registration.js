import express from 'express';
import { Database, ImageRepository, UserRepository } from '../data/repositories.js';

const router = express.Router();

// Database will be injected via middleware
let db, imageRepo, userRepo;

// Middleware to initialize database connection if not already done
router.use(async (req, res, next) => {
  if (!db) {
    db = new Database();
    await db.connect();
    imageRepo = new ImageRepository(db);
    userRepo = new UserRepository(db);
  }
  next();
});

/**
 * GET /registration/images
 * Get all available images for registration
 * 
 * Response (200 OK):
 * {
 *   "images": [
 *     {
 *       "imageId": "elephant_001",
 *       "fileName": "elephant.svg",
 *       "displayName": "Elephant",
 *       "properties": {
 *         "color": "gray",
 *         "sound": "trumpet",
 *         "habitat": "savanna"
 *       }
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/images', async (req, res, next) => {
  try {
    const images = await imageRepo.getAllImages();
    
    // Format response to include only necessary fields
    const formattedImages = images.map(img => ({
      imageId: img.imageId,
      fileName: img.fileName,
      displayName: img.displayName,
      properties: {
        color: img.properties.color,
        sound: img.properties.sound,
        habitat: img.properties.habitat
      }
    }));

    res.status(200).json({ images: formattedImages });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /registration/register
 * Register a new user with their chosen image
 * 
 * Request:
 * {
 *   "userId": "user123",
 *   "imageId": "elephant_001"
 * }
 * 
 * Response (201 Created):
 * {
 *   "success": true,
 *   "userId": "user123",
 *   "message": "Registration successful"
 * }
 * 
 * Response (400 Bad Request):
 * {
 *   "error": "Invalid image ID"
 * }
 * 
 * Response (409 Conflict):
 * {
 *   "error": "User already exists"
 * }
 */
router.post('/register', async (req, res, next) => {
  try {
    const { userId, imageId } = req.body;

    // Validate input
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (!imageId || typeof imageId !== 'string' || imageId.trim() === '') {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    // Check if user already exists
    const existingUser = await userRepo.getUserById(userId);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Validate image exists and has all required properties
    const image = await imageRepo.getImageById(imageId);
    if (!image) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    // Validate image has all required properties (color, sound, habitat)
    const requiredProperties = ['color', 'sound', 'habitat'];
    const missingProperties = requiredProperties.filter(
      prop => !image.properties[prop] || image.properties[prop].trim() === ''
    );

    if (missingProperties.length > 0) {
      return res.status(400).json({ 
        error: 'Image missing required properties',
        missingProperties 
      });
    }

    // Create user
    await userRepo.createUser(userId, imageId);

    res.status(201).json({
      success: true,
      userId,
      message: 'Registration successful'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /registration/image/:imageId/properties
 * Get properties for a specific image
 * 
 * Response (200 OK):
 * {
 *   "imageId": "elephant_001",
 *   "properties": {
 *     "color": "gray",
 *     "sound": "trumpet",
 *     "habitat": "savanna",
 *     "category": "mammal"
 *   }
 * }
 * 
 * Response (404 Not Found):
 * {
 *   "error": "Image not found"
 * }
 */
router.get('/image/:imageId/properties', async (req, res, next) => {
  try {
    const { imageId } = req.params;

    // Validate imageId
    if (!imageId || typeof imageId !== 'string' || imageId.trim() === '') {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    // Get image properties
    const properties = await imageRepo.getImageProperties(imageId);
    
    if (!properties) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.status(200).json({
      imageId,
      properties
    });
  } catch (error) {
    next(error);
  }
});

export default router;
