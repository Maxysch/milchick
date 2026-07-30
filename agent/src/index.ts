import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createNormalizationAgent, createSettlementAgent } from './agents/index.js';
import { HumanMessage } from '@langchain/core/messages';

const app = express();
const PORT = process.env.AGENT_PORT || 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'milchick-agent' });
});

// Chat with normalization agent
app.post('/chat/normalization', async (req, res) => {
  const { message, thread_id } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const agent = createNormalizationAgent();
    const result = await agent.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: thread_id || 'default' } }
    );

    const lastMessage = result.messages[result.messages.length - 1];
    res.json({
      response: lastMessage.content,
      thread_id: thread_id || 'default',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Chat with settlement agent
app.post('/chat/settlement', async (req, res) => {
  const { message, thread_id } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const agent = createSettlementAgent();
    const result = await agent.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: thread_id || 'default' } }
    );

    const lastMessage = result.messages[result.messages.length - 1];
    res.json({
      response: lastMessage.content,
      thread_id: thread_id || 'default',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Milchick Agent service running on port ${PORT}`);
});
