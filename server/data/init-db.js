import { Database } from './repositories.js';

/**
 * Initialize the database with schema and seed data
 * Run this script to set up the database for the first time
 */
async function initializeDatabase() {
  const db = new Database();
  
  try {
    console.log('Connecting to database...');
    await db.connect();
    console.log('✓ Connected to database');
    
    console.log('Initializing schema...');
    await db.initializeSchema();
    console.log('✓ Schema initialized');
    
    console.log('Seeding images...');
    await db.seedImages();
    console.log('✓ Images seeded');
    
    // Verify seed data
    const images = await db.query('SELECT * FROM images');
    console.log(`✓ Database initialized with ${images.length} images:`);
    images.forEach(img => {
      console.log(`  - ${img.display_name} (${img.image_id}): ${img.color}, ${img.sound}, ${img.habitat}`);
    });
    
    await db.close();
    console.log('✓ Database connection closed');
    console.log('\nDatabase initialization complete!');
  } catch (error) {
    console.error('Error initializing database:', error);
    await db.close();
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase();
}

export default initializeDatabase;
