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

const TEMPLATES_FILE = './templates.json';
const PERSONA_FILE = './persona.json';

let templates = [];
if (fs.existsSync(TEMPLATES_FILE)) templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
const saveTemplates = () => fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));

let persona = { brand: "XYZ Şirketi", address: "Örnek Mah. 123, İstanbul", tone: "Samimi, kısa ve anlaşılır", extra_instructions: "Asla spam yapma, her zaman yardımcı ol." };
if (fs.existsSync(PERSONA_FILE)) persona = JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf-8'));
const savePersona = () => fs.writeFileSync(PERSONA_FILE, JSON.stringify(persona, null, 2));

const messageHistory = {};

const SESSION_DIR = './.wwebjs_auth';
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
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

let qrCode = null;

client.on('qr', (qr) => {
    qrCode = qr;
    console.log('QR oluşturuldu');
    io.emit('qr', qr);
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp doğrulandı');
    io.emit('authenticated');
});

client.on('ready', () => {
    qrCode = null;
    console.log('✅ WhatsApp bağlı');
    io.emit('ready');
});

client.on('disconnected', () => {
    console.log('⚠️ Bağlantı koptu');
    io.emit('disconnected');
});

client.initialize();

client.on('message', async (message) => {
    const from = message.from;

    try {
        const match = templates.find(t =>
            message.body.toLowerCase().includes(t.trigger.toLowerCase())
        );
        if (match) {
            await client.sendMessage(from, match.reply);
            if (!messageHistory[from]) messageHistory[from] = [];
            messageHistory[from].push({ role: 'user', content: message.body });
            messageHistory[from].push({ role: 'assistant', content: match.reply });
            io.emit('message', { from, body: message.body, reply: match.reply });
            return;
        }

        console.log(`💬 Yeni mesaj: ${message.body}`);

        if (!messageHistory[from]) messageHistory[from] = [];
        messageHistory[from].push({ role: 'user', content: message.body });
        if (messageHistory[from].length > 20) messageHistory[from].shift();

        const systemPrompt = `
Sen ${persona.brand} markasının resmi WhatsApp asistanısın.
Adres: ${persona.address}
Tarz: ${persona.tone}
${persona.extra_instructions}
`;

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                ...messageHistory[from]
            ],
        });

        const aiReply = completion.choices[0]?.message?.content || "Anlayamadım 😅";

        await client.sendMessage(from, aiReply);

        messageHistory[from].push({ role: 'assistant', content: aiReply });
        if (messageHistory[from].length > 20) messageHistory[from].shift();

        io.emit('message', { from, body: message.body, reply: aiReply });

    } catch (err) {
        console.error('❌ Groq AI hata:', err);
        await client.sendMessage(from, "AI servisine şu anda ulaşılamıyor. Daha sonra tekrar deneyin.");
    }
});


app.get('/api/templates', (req, res) => res.json(templates));

app.post('/api/templates', (req, res) => {
    const { trigger, reply } = req.body;
    templates.push({ trigger, reply });
    saveTemplates();
    res.json({ success: true });
});

app.delete('/api/templates/:index', (req, res) => {
    const { index } = req.params;
    templates.splice(index, 1);
    saveTemplates();
    res.json({ success: true });
});

app.get('/api/persona', (req, res) => res.json(persona));
app.post('/api/persona', (req, res) => {
    persona = req.body;
    savePersona();
    res.json({ success: true });
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
