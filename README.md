# B-Team Login System

A web-based authentication system using image recognition combined with personalized security questions.

## Prerequisites

- Node.js (v18 or higher)
- npm (comes with Node.js)

## Installation

No installation required! Just open `index.html` in your browser.

## Database

The system uses browser localStorage for data persistence. All data is stored locally in your browser.

## How to Use

## Project Structure

```
.
├── client/                 # Frontend code
│   └── main.js            # Combined app, auth, and registration flows
├── server/                 # Backend code (optional - not needed for standalone)
│   ├── routes/            # API endpoints
│   ├── data/              # Data layer (repositories)
│   │   ├── repositories.js # Combined database and repositories
│   │   └── init-db.js     # Database initialization
│   └── config/            # Server configuration
├── public/
│   └── images/            # Static image assets
└── package.json
```

## Usage

Simply open `index.html` in your web browser. No server or installation required!

The application runs entirely client-side using localStorage for data persistence.

## How to Use

1. Open `index.html` in your web browser
2. Click "Sign up!" to create a new account
3. Pick your favorite animal, color, and lucky number
4. Enter your name and complete registration
5. Log in by selecting your animal and answering your security question

## Scripts

- `npm start` - Start the production server
- `npm run dev` - Start development server with auto-reload
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:unit` - Run unit tests only
- `npm run test:property` - Run property-based tests only
- `npm run test:integration` - Run integration tests only

## Testing

The project uses:
- **Jest** for unit and integration testing
- **fast-check** for property-based testing
- **supertest** for API endpoint testing
- **@testing-library/dom** for DOM testing

### Coverage Thresholds

- Lines: 80%
- Branches: 75%
- Functions: 80%
- Statements: 80%

## Development

1. Start the development server:
```bash
npm run dev
```

2. Run tests:
```bash
npm test
```

## Features

- 9 animal choices for authentication
- Personalized security questions (favorite color, lucky number)
- Runs entirely in the browser - no server needed
- Data stored locally using localStorage
- Simple and intuitive interface

## Architecture

- **Frontend**: Vanilla JavaScript (no frameworks)
- **Storage**: Browser localStorage
- **Standalone**: No backend required

## License

MIT
