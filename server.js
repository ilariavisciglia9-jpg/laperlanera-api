const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ical = require('node-ical');
const nodemailer = require('nodemailer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================
// STRIPE CONFIGURATION (SICURA)
// ===========================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ===========================
// EMAIL CONFIGURATION
// ===========================
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ===========================
// MIDDLEWARE
// ===========================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===========================
// CONFIGURAZIONE AIRBNB
// ===========================
const AIRBNB_ICAL_URL = process.env.AIRBNB_ICAL_URL;

// Cache per ridurre le chiamate ad Airbnb
let cachedBookedDates = [];
let lastSyncTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minuti

// ===========================
// DATE BLOCCATE LOCALMENTE
// ===========================
const BLOCKED_DATES_FILE = './blocked_dates.json';

function loadBlockedDates() {
    try {
        if (fs.existsSync(BLOCKED_DATES_FILE)) {
            return JSON.parse(fs.readFileSync(BLOCKED_DATES_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveBlockedDates(dates) {
    try {
        fs.writeFileSync(BLOCKED_DATES_FILE, JSON.stringify(dates));
    } catch (e) {
        console.error('❌ Errore salvataggio date:', e.message);
    }
}

let locallyBlockedDates = loadBlockedDates();

// ===========================
// API ENDPOINT - SYNC CALENDAR
// ===========================
app.post('/api/sync-calendar', async (req, res) => {
    try {
        const now = Date.now();
        if (lastSyncTime && (now - lastSyncTime) < CACHE_DURATION && cachedBookedDates.length > 0) {
            console.log('✅ Uso cache per le date prenotate');
            return res.json({
                success: true,
                bookedDates: cachedBookedDates,
                cached: true,
                lastSync: new Date(lastSyncTime).toISOString()
            });
        }

        console.log('📅 Sincronizzazione con Airbnb in corso...');
        console.log('🔗 URL iCal:', AIRBNB_ICAL_URL);
        
        const response = await fetch(AIRBNB_ICAL_URL);
        
        if (!response.ok) {
            throw new Error(`Errore HTTP: ${response.status} ${response.statusText}`);
        }
        
        const icalData = await response.text();
        
        if (!icalData.includes('BEGIN:VCALENDAR')) {
            throw new Error('Il file scaricato non è un iCalendar valido');
        }
        
        console.log('📥 File iCal scaricato, parsing in corso...');
        
        const events = ical.sync.parseICS(icalData);
        const bookedDates = [];
        let eventCount = 0;
        
        for (let event of Object.values(events)) {
            if (event.type === 'VEVENT' && event.start && event.end) {
                eventCount++;
                
                const start = new Date(event.start);
                const end = new Date(event.end);
                
                console.log(`📌 Evento ${eventCount}:`, {
                    summary: event.summary || 'N/A',
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0]
                });
                
                let current = new Date(start);
                while (current < end) {
                    const dateString = current.toISOString().split('T')[0];
                    if (!bookedDates.includes(dateString)) {
                        bookedDates.push(dateString);
                    }
                    current.setDate(current.getDate() + 1);
                }
            }
        }
        
        const allDates = [...new Set([...bookedDates, ...locallyBlockedDates])].sort();
        cachedBookedDates = allDates;
        lastSyncTime = now;
        
        console.log('✅ Sincronizzazione completata!');
        console.log(`📊 Trovati ${eventCount} eventi totali`);
        console.log(`📅 ${allDates.length} date prenotate`);
        
        res.json({
            success: true,
            bookedDates: allDates,
            totalEvents: eventCount,
            totalDays: allDates.length,
            cached: false,
            syncTime: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Errore nella sincronizzazione:', error.message);
        
        if (cachedBookedDates.length > 0) {
            console.log('⚠️ Uso cache come fallback');
            return res.json({
                success: true,
                bookedDates: cachedBookedDates,
                cached: true,
                error: error.message,
                lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : null
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Errore nella sincronizzazione del calendario',
            details: error.message,
            bookedDates: []
        });
    }
});

// ===========================
// API ENDPOINT - GET CALENDAR
// ===========================
app.get('/api/calendar', async (req, res) => {
    try {
        const now = Date.now();
        if (lastSyncTime && (now - lastSyncTime) < CACHE_DURATION && cachedBookedDates.length > 0) {
            return res.json({
                success: true,
                bookedDates: cachedBookedDates,
                cached: true
            });
        }

        const response = await fetch(AIRBNB_ICAL_URL);
        const icalData = await response.text();
        const events = ical.sync.parseICS(icalData);
        
        const bookedDates = [];
        for (let event of Object.values(events)) {
            if (event.type === 'VEVENT' && event.start && event.end) {
                let current = new Date(event.start);
                const end = new Date(event.end);
                while (current < end) {
                    const dateString = current.toISOString().split('T')[0];
                    if (!bookedDates.includes(dateString)) {
                        bookedDates.push(dateString);
                    }
                    current.setDate(current.getDate() + 1);
                }
            }
        }
        
        const allDates = [...new Set([...bookedDates, ...locallyBlockedDates])].sort();
        cachedBookedDates = allDates;
        lastSyncTime = now;
        
        res.json({
            success: true,
            bookedDates: allDates
        });
        
    } catch (error) {
        console.error('❌ Errore:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            bookedDates: cachedBookedDates
        });
    }
});

// ===========================
// STRIPE PAYMENT INTENT (SICURO)
// ===========================
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { amount, currency, bookingData } = req.body;
        
        if (!amount || amount < 50) {
            return res.status(400).json({
                error: 'Importo non valido'
            });
        }
        
        console.log('💳 Creazione Payment Intent per:', {
            amount: amount / 100,
            currency: currency,
            cliente: `${bookingData.firstName} ${bookingData.lastName}`
        });
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency || 'eur',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                property: 'La Perla Nera',
                checkIn: bookingData.checkIn,
                checkOut: bookingData.checkOut,
                nights: bookingData.nights,
                guestName: `${bookingData.firstName} ${bookingData.lastName}`,
                guestEmail: bookingData.email,
                guestPhone: bookingData.phone,
                adults: bookingData.adults,
                children: bookingData.children || 0
            },
            description: `Prenotazione La Perla Nera - ${bookingData.checkIn} to ${bookingData.checkOut}`,
            receipt_email: bookingData.email
        });
        
        console.log('✅ Payment Intent creato:', paymentIntent.id);
        
        res.json({
            clientSecret: paymentIntent.client_secret
        });
        
    } catch (error) {
        console.error('❌ Errore creazione Payment Intent:', error.message);
        res.status(500).json({
            error: 'Errore nella creazione del pagamento',
            details: error.message
        });
    }
});

// ===========================
// WEBHOOK STRIPE (CONFERMA PAGAMENTI)
// ===========================
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('❌ Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const meta = paymentIntent.metadata;
        const importo = (paymentIntent.amount / 100).toFixed(2);

        console.log('💰 Pagamento ricevuto:', paymentIntent.id);

        // Blocca le date automaticamente
        if (meta.checkIn && meta.checkOut) {
            const checkIn = new Date(meta.checkIn);
            const checkOut = new Date(meta.checkOut);
            let current = new Date(checkIn);
            
            while (current < checkOut) {
                const dateString = current.toISOString().split('T')[0];
                if (!locallyBlockedDates.includes(dateString)) {
                    locallyBlockedDates.push(dateString);
                }
                current.setDate(current.getDate() + 1);
            }
            
            saveBlockedDates(locallyBlockedDates);
            lastSyncTime = null; // Invalida cache
            console.log(`🔒 Date bloccate: ${meta.checkIn} → ${meta.checkOut}`);
        }

        // Invia email di notifica
        try {
            await emailTransporter.sendMail({
                from: '"La Perla Nera" <info@laperlanera.eu>',
                to: 'info@laperlanera.eu',
                subject: `🏠 NUOVA PRENOTAZIONE - ${meta.guestName} | ${meta.checkIn} → ${meta.checkOut}`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                        <div style="background:#8B0000;color:white;padding:20px;text-align:center;">
                            <h1 style="margin:0;">🏠 La Perla Nera</h1>
                            <p style="margin:5px 0 0;">Nuova Prenotazione Confermata</p>
                        </div>
                        <div style="padding:30px;border:1px solid #ddd;">
                            <h2 style="color:#8B0000;">✅ Pagamento ricevuto!</h2>
                            <table style="width:100%;border-collapse:collapse;">
                                <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Ospite</td><td style="padding:10px;border:1px solid #eee;">${meta.guestName}</td></tr>
                                <tr><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Email</td><td style="padding:10px;border:1px solid #eee;">${paymentIntent.receipt_email}</td></tr>
                                <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Telefono</td><td style="padding:10px;border:1px solid #eee;">${meta.guestPhone || 'N/D'}</td></tr>
                                <tr><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Check-in</td><td style="padding:10px;border:1px solid #eee;color:#8B0000;font-weight:bold;">${meta.checkIn}</td></tr>
                                <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Check-out</td><td style="padding:10px;border:1px solid #eee;color:#8B0000;font-weight:bold;">${meta.checkOut}</td></tr>
                                <tr><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Notti</td><td style="padding:10px;border:1px solid #eee;">${meta.nights}</td></tr>
                                <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Ospiti</td><td style="padding:10px;border:1px solid #eee;">${meta.adults} adulti, ${meta.children || 0} bambini</td></tr>
                                <tr><td style="padding:10px;border:1px solid #eee;font-weight:bold;">💰 Totale</td><td style="padding:10px;border:1px solid #eee;font-size:18px;color:#8B0000;font-weight:bold;">€${importo}</td></tr>
                                <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">ID Pagamento</td><td style="padding:10px;border:1px solid #eee;font-size:12px;color:#666;">${paymentIntent.id}</td></tr>
                            </table>
                            <div style="background:#fff3cd;border:1px solid #ffc107;padding:15px;margin-top:20px;">
                                <strong>⚠️ AZIONE RICHIESTA:</strong><br>
                                Blocca le date <strong>${meta.checkIn} → ${meta.checkOut}</strong> su Airbnb per evitare doppie prenotazioni.
                            </div>
                        </div>
                    </div>
                `
            });
            console.log('📧 Email notifica inviata');
        } catch (emailError) {
            console.error('❌ Errore invio email:', emailError.message);
        }
    }
    
    res.json({received: true});
});

// ===========================
// API ENDPOINT - STATUS
// ===========================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'La Perla Nera Booking System',
        lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : 'Never',
        cachedDates: cachedBookedDates.length,
        cacheValid: lastSyncTime && (Date.now() - lastSyncTime) < CACHE_DURATION,
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        locallyBlockedDates: locallyBlockedDates.length
    });
});

// ===========================
// ROOT ENDPOINT
// ===========================
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>La Perla Nera - Booking API</title>
            <style>
                body { font-family: Arial; padding: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #8B0000; }
                .endpoint { background: #f9f9f9; padding: 15px; margin: 10px 0; border-left: 4px solid #8B0000; }
                code { background: #eee; padding: 2px 6px; border-radius: 3px; }
                .status { color: #28a745; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🏠 La Perla Nera - Booking API</h1>
                <p class="status">✅ Server Online</p>
                <h2>📊 Info:</h2>
                <ul>
                    <li>Date Airbnb in cache: <strong>${cachedBookedDates.length}</strong></li>
                    <li>Date bloccate localmente: <strong>${locallyBlockedDates.length}</strong></li>
                    <li>Ultimo sync: <strong>${lastSyncTime ? new Date(lastSyncTime).toLocaleString('it-IT') : 'Mai'}</strong></li>
                    <li>Stripe: <strong>${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Non configurato'}</strong></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// ===========================
// GESTIONE ERRORI 404
// ===========================
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint non trovato',
        path: req.path
    });
});

// ===========================
// AVVIO SERVER
// ===========================
app.listen(PORT, () => {
    console.log('');
    console.log('🏠 ================================');
    console.log('   LA PERLA NERA BOOKING SYSTEM');
    console.log('   ================================');
    console.log('');
    console.log(`✅ Server avviato su http://localhost:${PORT}`);
    console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Mancante'}`);
    console.log(`📅 Date bloccate localmente: ${locallyBlockedDates.length}`);
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n👋 Chiusura server...');
    process.exit(0);
});
