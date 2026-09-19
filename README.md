# USAJobsPro

Full-stack job portal project.

## Frontend
- `index.html` — job search and listings
- `public/login.html` — login/register
- `public/admin.html` — admin dashboard
- `public/resume-ai.html` — resume keyword matching

## Backend
- `server.js` — Express API
- MongoDB Atlas via `MONGODB_URI`
- JWT authentication
- Stripe Checkout endpoint

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill in your secrets.
3. `npm start`
4. Open `http://localhost:5000`

Never commit `.env` or Stripe secret keys.

## Production
GitHub can store the project source, but GitHub Pages does not run the Node/Express backend. Deploy the backend separately (for example on Render) and keep the frontend API URL pointed at that backend.
