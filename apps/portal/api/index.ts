// Vercel serverless adapter — exports the Express app as a default export
// Vercel's @vercel/node runtime handles the listen() lifecycle
import app from '../src/server/index.js'

export default app
