import express from 'express';
import cors from 'cors';
import 'express-async-errors';
import quotesRouter from './routes/quotes';
import inventoryRouter from './routes/inventory';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/quotes', quotesRouter);
app.use('/api/inventory', inventoryRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
