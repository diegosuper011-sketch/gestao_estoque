const express = require('express');
    const path = require('path');
    const { pool, initDb } = require('./db');
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));


app.get('/api/products', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/products', async (req, res, next) => {
  try {
    const { name, sku, category, quantity = 0, min_quantity = 5, unit_price = 0 } = req.body;
    if (![name, sku, category].every(v => typeof v === 'string' && v.trim())) {
      return res.status(400).json({ error: 'Preencha produto, código e categoria.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO products (name,sku,category,quantity,min_quantity,unit_price)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), sku.trim().toUpperCase(), category.trim(), quantity, min_quantity, unit_price]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Este código já está cadastrado.' });
    next(e);
  }
});

app.post('/api/products/:id/movements', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { type, quantity, note = '' } = req.body;
    const amount = Number(quantity);
    if (!['entrada','saida'].includes(type) || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Informe entrada ou saída e uma quantidade inteira maior que zero.' });
    }
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Produto não encontrado.' }); }
    const product = found.rows[0];
    const nextQty = Number(product.quantity) + (type === 'entrada' ? amount : -amount);
    if (nextQty < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Estoque insuficiente para essa saída.' }); }
    await client.query('UPDATE products SET quantity=$1 WHERE id=$2', [nextQty, req.params.id]);
    const movement = await client.query(
      'INSERT INTO stock_movements (product_id,movement_type,quantity,note) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, type, amount, note]
    );
    await client.query('COMMIT');
    res.status(201).json(movement.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

app.get('/api/movements', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, p.name AS product_name, p.sku FROM stock_movements m
       JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 50`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.delete('/api/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.status(204).end();
  } catch (e) { next(e); }
});


    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

    app.use((err, _req, res, _next) => {
      console.error(err);
      res.status(500).json({ error: 'Erro interno do servidor.' });
    });

    initDb()
      .then(() => app.listen(PORT, () => console.log(`Controle de Estoque rodando em http://localhost:${PORT}`)))
      .catch(err => { console.error('Falha ao iniciar:', err); process.exit(1); });
