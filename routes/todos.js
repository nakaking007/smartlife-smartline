const express = require('express');
const todos = require('../utils/todos');
const { requireLineUser } = require('../middleware/lineAuth');

const router = express.Router();
router.use(requireLineUser);

router.get('/', async (req, res) => {
  try {
    const items = await todos.listTodos({
      status: req.query.status,
      activeOnly: req.query.activeOnly === 'true',
      openOnly: req.query.openOnly === 'true',
      lineUserId: req.lineUserId,
      limit: Number(req.query.limit) || 100
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', async (req, res) => {
  try {
    const items = await todos.getToday(new Date(), { lineUserId: req.lineUserId });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/week', async (req, res) => {
  try {
    const items = await todos.getThisWeek(new Date(), { lineUserId: req.lineUserId });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const todo = await todos.createTodo({ ...req.body, lineUserId: req.lineUserId });
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const todo = await todos.updateTodo(req.params.id, req.body, {
      lineUserId: req.lineUserId
    });
    res.json(todo);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const todo = await todos.completeTodo(req.params.id, {
      lineUserId: req.lineUserId
    });
    res.json(todo);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/:id/reopen', async (req, res) => {
  try {
    const todo = await todos.reopenTodo(req.params.id, {
      lineUserId: req.lineUserId
    });
    res.json(todo);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const todo = await todos.deleteTodo(req.params.id, {
      lineUserId: req.lineUserId
    });
    res.json(todo);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
