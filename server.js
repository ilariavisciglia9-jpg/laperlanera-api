const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ical = require('node-ical');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================
// STRIPE CONFIGURATION (SICURA)
// ===========================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
        
        bookedDates.sort();
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
// 🆕 STRIPE PAYMENT INTENT (SICURO)
// ===========================
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { amount, currency, bookingData } = req.body;
        
        // Validazione
        if (!amount || amount < 50) { // Minimo 0.50€
            return res.status(400).json({
                error: 'Importo non valido'
            });
        }
        
        console.log('💳 Creazione Payment Intent per:', {
            amount: amount / 100,
            currency: currency,
            cliente: `${bookingData.firstName} ${bookingData.lastName}`
        });
        
        // Crea il Payment Intent
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
        
        // Invia SOLO il client secret al frontend (sicuro)
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
// Endpoint per fornire la chiave pubblica Stripe al frontend
app.get('/api/stripe-config', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLIC_KEY
    });
});

// ===========================
// 🆕 WEBHOOK STRIPE (CONFERMA PAGAMENTI)
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
    
    // Gestisci l'evento
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        console.log('💰 Pagamento ricevuto:', paymentIntent.id);
        console.log('📧 Cliente:', paymentIntent.receipt_email);
        console.log('💵 Importo:', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
        
        // QUI: Invia email di conferma, salva nel database, ecc.
        // await sendConfirmationEmail(paymentIntent.metadata);
        // await saveBookingToDatabase(paymentIntent.metadata);
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
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY
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
                    <strong>POST /api/create-payment-intent</strong><br>
                    Crea un pagamento Stripe sicuro
                </div>
                
                <div class="endpoint">
                    <strong>POST /api/webhook</strong><br>
                    Ricevi conferme pagamento da Stripe
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
                    <li>Stripe: <strong>${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Non configurato'}</strong></li>
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
    console.log('   LA PERLA NERA BOOKING SYSTEM');
    console.log('   ================================');
    console.log('');
    console.log(`✅ Server avviato su http://localhost:${PORT}`);
    console.log(`📡 API disponibile su http://localhost:${PORT}/api`);
    console.log('');
    console.log('📌 Endpoints disponibili:');
    console.log('   POST /api/sync-calendar - Sync con Airbnb');
    console.log('   GET  /api/calendar - Ottieni date prenotate');
    console.log('   POST /api/create-payment-intent - Crea pagamento Stripe');
    console.log('   POST /api/webhook - Webhook Stripe');
    console.log('   GET  /api/status - Stato del sistema');
    console.log('');
    console.log('⏰ Auto-sync ogni 5 minuti');
    console.log('💾 Cache: 5 minuti');
    console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Mancante'}`);
    console.log('');
});

// ===========================
// GESTIONE CHIUSURA SERVER
// ===========================
process.on('SIGINT', () => {
    console.log('\n👋 Chiusura server...');
    process.exit(0);
});
