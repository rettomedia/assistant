import 'dotenv/config';
import Groq from "groq-sdk";

import express from 'express';
import cors from 'cors';
import qrcode from 'qrcode-terminal';
import { Server } from 'socket.io';
import http from 'http';
import fs from 'fs';

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let templates = [];
const SESSION_DIR = './.wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: SESSION_DIR,
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
  },
});

client.on('qr', (qr) => {
    console.log('QR oluşturuldu');
    io.emit('qr', qr);
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp doğrulandı');
    io.emit('authenticated');
});

client.on('ready', () => {
    console.log('✅ WhatsApp bağlı');
    io.emit('ready');
});

client.on('disconnected', () => {
    console.log('⚠️ Bağlantı koptu');
    io.emit('disconnected');
});

client.initialize();

client.on('message', async (message) => {
  try {
    const match = templates.find(t =>
      message.body.toLowerCase().includes(t.trigger.toLowerCase())
    );
    if (match) {
      await client.sendMessage(message.from, match.reply);
      return;
    }

    console.log(`💬 Yeni mesaj: ${message.body}`);

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Kısa, samimi ve doğal Türkçe yanıtlar ver." },
        { role: "user", content: message.body }
      ],
    });

    const aiReply = completion.choices[0]?.message?.content || "Anlayamadım 😅";

    await client.sendMessage(message.from, aiReply);
    console.log(`🤖 Gönderilen cevap: ${aiReply}`);

  } catch (err) {
    console.error('❌ Groq AI hata:', err);
    await client.sendMessage(message.from, "AI servisine şu anda ulaşılamıyor. Daha sonra tekrar deneyin.");
  }
});

client.on('qr', (qr) => {
    qrCode = qr;
    io.emit('qr', qr);
});

client.on('ready', () => {
    qrCode = null;
    io.emit('ready');
});


app.get('/api/templates', (req, res) => {
    res.json(templates);
});

app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'ok', 
        whatsapp: client.ready ? 'connected' : 'disconnected',
        qr: !!qrCode 
    });
});

app.post('/api/request-qr', (req, res) => {
    if (client) {
        client.initialize();
        res.json({ status: 'qr_requested' });
    } else {
        res.status(400).json({ error: 'Client not initialized' });
    }
});

app.post('/api/templates', (req, res) => {
    const { trigger, reply } = req.body;
    templates.push({ trigger, reply });
    res.json({ success: true });
});

app.delete('/api/templates/:index', (req, res) => {
    const { index } = req.params;
    templates.splice(index, 1);
    res.json({ success: true });
});

app.post('/api/logout', async (req, res) => {
    try {
        await client.logout();
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        res.json({ success: true });
        console.log('🚪 Oturum kapatıldı');
        process.exit(0);
    } catch (err) {
        console.error('Çıkış hatası:', err);
        res.status(500).json({ success: false });
    }
});

server.listen(3000, () => console.log('Server 3000 portunda çalışıyor.'));
