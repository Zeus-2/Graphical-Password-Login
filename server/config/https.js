import https from 'https';
import fs from 'fs';
import path from 'path';

/**
 * HTTPS/TLS Configuration for Production
 * 
 * This module provides HTTPS server configuration for production environments.
 * In development, the standard HTTP server is used.
 * 
 * To enable HTTPS in production:
 * 1. Set NODE_ENV=production
 * 2. Set HTTPS_ENABLED=true
 * 3. Provide SSL certificate paths in environment variables
 */

/**
 * Load SSL certificates from file system
 * @returns {Object|null} SSL options object or null if certificates not found
 */
export function loadSSLCertificates() {
  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;
  const caPath = process.env.SSL_CA_PATH;

  if (!keyPath || !certPath) {
    console.warn('SSL certificate paths not configured. HTTPS disabled.');
    return null;
  }

  try {
    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };

    // Add CA bundle if provided (for intermediate certificates)
    if (caPath) {
      sslOptions.ca = fs.readFileSync(caPath);
    }

    console.log('SSL certificates loaded successfully');
    return sslOptions;
  } catch (error) {
    console.error('Failed to load SSL certificates:', error.message);
    return null;
  }
}

/**
 * Create HTTPS server with the Express app
 * @param {Express} app - Express application instance
 * @returns {https.Server|null} HTTPS server or null if SSL not configured
 */
export function createHTTPSServer(app) {
  const sslOptions = loadSSLCertificates();
  
  if (!sslOptions) {
    return null;
  }

  return https.createServer(sslOptions, app);
}

/**
 * Check if HTTPS should be enabled
 * @returns {boolean} True if HTTPS should be enabled
 */
export function shouldUseHTTPS() {
  return process.env.NODE_ENV === 'production' && 
         process.env.HTTPS_ENABLED === 'true';
}

/**
 * Get recommended SSL/TLS configuration options
 * @returns {Object} Recommended SSL options
 */
export function getRecommendedSSLOptions() {
  return {
    // Use TLS 1.2 and 1.3 only (disable older versions)
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    
    // Prefer server cipher order
    honorCipherOrder: true,
    
    // Recommended cipher suites (strong encryption)
    ciphers: [
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-CHACHA20-POLY1305',
      'ECDHE-RSA-CHACHA20-POLY1305',
      'DHE-RSA-AES128-GCM-SHA256',
      'DHE-RSA-AES256-GCM-SHA384'
    ].join(':')
  };
}

export default {
  loadSSLCertificates,
  createHTTPSServer,
  shouldUseHTTPS,
  getRecommendedSSLOptions
};
