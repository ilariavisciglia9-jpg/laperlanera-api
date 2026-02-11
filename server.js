const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ical = require('node-ical');

const app = express();
const PORT = process.env.PORT || 3000;

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
// ===========================
// MIDDLEWARE
// ===========================
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Metti tutti i tuoi file HTML/CSS/JS in una cartella "public"
// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
// ===========================
// CONFIGURAZIONE AIRBNB
// ===========================
const AIRBNB_ICAL_URL = 'https://www.airbnb.it/calendar/ical/1285916612879223148.ics?t=2a76b60e0e2347999bb84d7e83a88418';

// Cache per ridurre le chiamate ad Airbnb
let cachedBookedDates = [];
let lastSyncTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minuti in millisecondi

// CREATE PAYMENT INTENT
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { amount, bookingData } = req.body;
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            metadata: {
                firstName: bookingData.firstName,
                lastName: bookingData.lastName,
                email: bookingData.email
            }
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// CONFIRM BOOKING
app.post('/api/confirm-booking', async (req, res) => {
    try {
        const booking = req.body;
        booking.bookingId = `LPN${Date.now()}`;
        
        // Invia email cliente
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: booking.email,
            subject: `✅ Prenotazione Confermata - ${booking.bookingId}`,
            html: `
                <h1>Prenotazione Confermata!</h1>
                <p>Codice: <strong>${booking.bookingId}</strong></p>
                <p>Check-in: ${booking.checkIn}</p>
                <p>Check-out: ${booking.checkOut}</p>
                <p>Totale pagato: €${booking.total}</p>
            `
        });
        
        // Invia email admin
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.ADMIN_EMAIL,
            subject: `🏡 Nuova Prenotazione - ${booking.firstName} ${booking.lastName}`,
            html: `
                <h2>Nuova Prenotazione</h2>
                <p>Cliente: ${booking.firstName} ${booking.lastName}</p>
                <p>Email: ${booking.email}</p>
                <p>Totale: €${booking.total}</p>
            `
        });
        
        res.json({ success: true, bookingId: booking.bookingId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// STRIPE CONFIG
app.get('/api/stripe-config', (req, res) => {
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});
// ===========================
// API ENDPOINT - SYNC CALENDAR
// ===========================
app.post('/api/sync-calendar', async (req, res) => {
    try {
        // Controlla se possiamo usare la cache
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
        
        // Scarica il file iCal da Airbnb
        const response = await fetch(AIRBNB_ICAL_URL);
        
        if (!response.ok) {
            throw new Error(`Errore HTTP: ${response.status} ${response.statusText}`);
        }
        
        const icalData = await response.text();
        
        // Verifica che sia un file iCal valido
        if (!icalData.includes('BEGIN:VCALENDAR')) {
            throw new Error('Il file scaricato non è un iCalendar valido');
        }
        
        console.log('📥 File iCal scaricato, parsing in corso...');
        
        // Parsa il file iCal
        const events = ical.sync.parseICS(icalData);
        
        const bookedDates = [];
        let eventCount = 0;
        
        // Estrai tutte le date prenotate
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
                
                // Aggiungi ogni giorno del periodo prenotato
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
        
        // Ordina le date
        bookedDates.sort();
        
        // Aggiorna la cache
        cachedBookedDates = bookedDates;
        lastSyncTime = now;
        
        console.log('✅ Sincronizzazione completata!');
        console.log(`📊 Trovati ${eventCount} eventi totali`);
        console.log(`📅 ${bookedDates.length} date prenotate`);
        
        res.json({
            success: true,
            bookedDates: bookedDates,
            totalEvents: eventCount,
            totalDays: bookedDates.length,
            cached: false,
            syncTime: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Errore nella sincronizzazione:', error.message);
        
        // Se abbiamo dati in cache, usali come fallback
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
            bookedDates: [] // Ritorna array vuoto in caso di errore
        });
    }
});

// ===========================
// API ENDPOINT - GET CALENDAR (metodo GET alternativo)
// ===========================
app.get('/api/calendar', async (req, res) => {
    try {
        // Usa la stessa logica del POST
        const now = Date.now();
        if (lastSyncTime && (now - lastSyncTime) < CACHE_DURATION && cachedBookedDates.length > 0) {
            return res.json({
                success: true,
                bookedDates: cachedBookedDates,
                cached: true
            });
        }

        // Altrimenti fai il sync
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
        
        bookedDates.sort();
        cachedBookedDates = bookedDates;
        lastSyncTime = now;
        
        res.json({
            success: true,
            bookedDates: bookedDates
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
// API ENDPOINT - STATUS
// ===========================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'Casa Vacanza Booking System',
        lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : 'Never',
        cachedDates: cachedBookedDates.length,
        cacheValid: lastSyncTime && (Date.now() - lastSyncTime) < CACHE_DURATION
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
            <title>Booking API</title>
            <style>
                body { font-family: Arial; padding: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #0047AB; }
                .endpoint { background: #f9f9f9; padding: 15px; margin: 10px 0; border-left: 4px solid #0047AB; }
                code { background: #eee; padding: 2px 6px; border-radius: 3px; }
                .status { color: #28a745; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🏠 Casa Vacanza Booking API</h1>
                <p class="status">✅ Server Online</p>
                
                <h2>📡 API Endpoints:</h2>
                
                <div class="endpoint">
                    <strong>POST /api/sync-calendar</strong><br>
                    Sincronizza il calendario con Airbnb
                </div>
                
                <div class="endpoint">
                    <strong>GET /api/calendar</strong><br>
                    Ottieni le date prenotate (usa cache se disponibile)
                </div>
                
                <div class="endpoint">
                    <strong>GET /api/status</strong><br>
                    Verifica lo stato del server
                </div>
                
                <h2>📊 Info:</h2>
                <ul>
                    <li>Date in cache: <strong>${cachedBookedDates.length}</strong></li>
                    <li>Ultimo sync: <strong>${lastSyncTime ? new Date(lastSyncTime).toLocaleString('it-IT') : 'Mai'}</strong></li>
                    <li>Cache valida: <strong>${lastSyncTime && (Date.now() - lastSyncTime) < CACHE_DURATION ? 'Sì' : 'No'}</strong></li>
                </ul>
                
                <p style="margin-top: 30px; color: #666; font-size: 14px;">
                    💡 I tuoi file HTML vanno nella cartella <code>public/</code>
                </p>
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
    console.log('   CASA VACANZA BOOKING SYSTEM');
    console.log('   ================================');
    console.log('');
    console.log(`✅ Server avviato su http://localhost:${PORT}`);
    console.log(`📡 API disponibile su http://localhost:${PORT}/api`);
    console.log('');
    console.log('📌 Endpoints disponibili:');
    console.log('   POST /api/sync-calendar - Sync con Airbnb');
    console.log('   GET  /api/calendar - Ottieni date prenotate');
    console.log('   GET  /api/status - Stato del sistema');
    console.log('');
    console.log('⏰ Auto-sync ogni 5 minuti');
    console.log('💾 Cache: 5 minuti');
    console.log('');
    console.log('🔗 URL Airbnb configurato');
    console.log('');
});

// ===========================
// GESTIONE CHIUSURA SERVER
// ===========================
process.on('SIGINT', () => {
    console.log('\n👋 Chiusura server...');
    process.exit(0);
});
