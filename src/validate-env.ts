import { loadConfig } from './config.js';

// Exits with code 1 and a list of missing variables if the environment is incomplete.
loadConfig();
console.log('All required environment variables are set.');
