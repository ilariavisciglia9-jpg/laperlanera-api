const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ical = require('node-ical');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());

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

    res.json({received: true});

    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        console.log('💰 [Webhook] Pagamento confermato da Stripe:', paymentIntent.id, '-', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
    }
});

app.use(express.json());
app.use(express.static('public'));

const AIRBNB_ICAL_URL = process.env.AIRBNB_ICAL_URL;

let cachedBookedDates = [];
let lastSyncTime = null;
const CACHE_DURATION = 5 * 60 * 1000;

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

app.get('/api/stripe-config', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLIC_KEY
    });
});

app.post('/api/confirm-booking', async (req, res) => {
    try {
        const bookingData = req.body;
        const bookingId = 'LPN-' + Date.now().toString(36).toUpperCase();

        console.log('📨 Nuova richiesta conferma prenotazione:', bookingId, '-', bookingData.email);

        // ⚠️ TEMPORANEO PER DIAGNOSI: aspettiamo l'invio email prima di rispondere,
        // così vediamo l'esito diretto nel popup del sito invece di cercare nei log.
        let emailStatus = 'non tentato';
        try {
            await sendBookingEmails(bookingData, bookingId);
            emailStatus = 'INVIATE CON SUCCESSO';
        } catch (emailErr) {
            emailStatus = 'ERRORE: ' + emailErr.message;
        }

        res.json({ success: true, bookingId, emailStatus });

    } catch (error) {
        console.error('❌ Errore in /api/confirm-booking:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function sendEmailViaResend({ to, subject, html }) {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'La Perla Nera <info@laperlanera.eu>',
            to: [to],
            subject: subject,
            html: html
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `Errore Resend (status ${response.status})`);
    }

    return data;
}

async function sendBookingEmails(bookingData, bookingId) {
    const m = {
        checkIn: bookingData.checkIn,
        checkOut: bookingData.checkOut,
        nights: bookingData.nights,
        adults: bookingData.adults,
        children: bookingData.children,
        guestName: `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim(),
        guestEmail: bookingData.email,
        guestPhone: bookingData.phone
    };
    const importo = parseFloat(bookingData.total || 0).toFixed(2);
    const valuta = 'EUR';

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/D';
        const d = new Date(dateStr);
        return d.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    await sendEmailViaResend({
        to: process.env.ADMIN_EMAIL || 'info@laperlanera.eu',
        subject: `🏠 Nuova prenotazione - ${m.guestName} | ${m.checkIn} → ${m.checkOut}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px;">
                <div style="background: #8B0000; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="margin: 0; font-size: 22px;">🏠 Nuova Prenotazione</h1>
                    <p style="margin: 5px 0 0 0; opacity: 0.9;">La Perla Nera</p>
                </div>
                <div style="background: white; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
                    <h2 style="color: #8B0000; margin-top: 0;">📅 Date</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 12px; font-weight: bold; width: 40%;">Check-in</td>
                            <td style="padding: 12px;">${formatDate(m.checkIn)} <strong>(${m.checkIn})</strong></td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; font-weight: bold;">Check-out</td>
                            <td style="padding: 12px;">${formatDate(m.checkOut)} <strong>(${m.checkOut})</strong></td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 12px; font-weight: bold;">Notti</td>
                            <td style="padding: 12px;"><strong>${m.nights}</strong></td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; font-weight: bold;">Ospiti</td>
                            <td style="padding: 12px;">${m.adults} adulti${m.children > 0 ? ', ' + m.children + ' bambini' : ''}</td>
                        </tr>
                    </table>
                    <h2 style="color: #8B0000;">👤 Cliente</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 12px; font-weight: bold; width: 40%;">Nome</td>
                            <td style="padding: 12px;">${m.guestName}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; font-weight: bold;">Email</td>
                            <td style="padding: 12px;"><a href="mailto:${m.guestEmail}">${m.guestEmail}</a></td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 12px; font-weight: bold;">Telefono</td>
                            <td style="padding: 12px;">${m.guestPhone || 'Non fornito'}</td>
                        </tr>
                    </table>
                    <h2 style="color: #8B0000;">💰 Pagamento</h2>
                    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center;">
                        <span style="font-size: 28px; font-weight: bold; color: #2e7d32;">€${importo} ${valuta}</span>
                        <br><span style="color: #666; font-size: 14px;">Pagamento confermato ✅</span>
                        <br><span style="color: #999; font-size: 12px;">Codice prenotazione: ${bookingId}</span>
                    </div>
                    <p style="margin-top: 20px; color: #666; font-size: 13px; border-top: 1px solid #eee; padding-top: 15px;">
                        ⚠️ Ricordati di bloccare le date <strong>${m.checkIn} → ${m.checkOut}</strong> sul calendario.
                    </p>
                </div>
            </div>
        `
    });

    if (m.guestEmail) {
        await sendEmailViaResend({
            to: m.guestEmail,
            subject: `✅ Prenotazione confermata - La Perla Nera | ${m.checkIn} → ${m.checkOut}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px;">
                    <div style="background: #8B0000; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="margin: 0; font-size: 22px;">✅ Prenotazione Confermata</h1>
                        <p style="margin: 5px 0 0 0; opacity: 0.9;">La Perla Nera</p>
                    </div>
                    <div style="background: white; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
                        <p style="font-size: 16px;">Caro/a <strong>${m.guestName}</strong>,</p>
                        <p>La tua prenotazione è confermata! Non vediamo l'ora di accoglierti.</p>
                        <h2 style="color: #8B0000;">📅 Dettagli soggiorno</h2>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: #f5f5f5;">
                                <td style="padding: 12px; font-weight: bold; width: 40%;">Check-in</td>
                                <td style="padding: 12px;">${formatDate(m.checkIn)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; font-weight: bold;">Check-out</td>
                                <td style="padding: 12px;">${formatDate(m.checkOut)}</td>
                            </tr>
                            <tr style="background: #f5f5f5;">
                                <td style="padding: 12px; font-weight: bold;">Notti</td>
                                <td style="padding: 12px;">${m.nights}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px; font-weight: bold;">Ospiti</td>
                                <td style="padding: 12px;">${m.adults} adulti${m.children > 0 ? ', ' + m.children + ' bambini' : ''}</td>
                            </tr>
                            <tr style="background: #f5f5f5;">
                                <td style="padding: 12px; font-weight: bold;">Totale pagato</td>
                                <td style="padding: 12px; font-weight: bold; color: #2e7d32;">€${importo}</td>
                            </tr>
                        </table>
                        <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #f9a825;">
                            <strong>📍 Dove siamo</strong><br>
                            La Perla Nera - consulta il sito per l'indirizzo esatto e le istruzioni per il check-in.
                        </div>
                        <p style="margin-top: 20px;">Per qualsiasi informazione non esitare a contattarci:</p>
                        <p>📧 <a href="mailto:info@laperlanera.eu" style="color: #8B0000;">info@laperlanera.eu</a></p>
                        <p style="margin-top: 30px; color: #666; font-size: 13px; border-top: 1px solid #eee; padding-top: 15px;">
                            A presto!<br><strong>Lo staff di La Perla Nera</strong>
                        </p>
                    </div>
                </div>
            `
        });
    }

    console.log('📧 Email admin inviata a:', process.env.ADMIN_EMAIL || 'info@laperlanera.eu');
    console.log('📧 Email cliente inviata a:', m.guestEmail);
}

app.get('/api/test-email', async (req, res) => {
    try {
        const data = await sendEmailViaResend({
            to: process.env.ADMIN_EMAIL || 'info@laperlanera.eu',
            subject: '🔧 Test email - La Perla Nera',
            html: '<p>Se leggi questo, Resend funziona correttamente!</p>'
        });

        res.send('<h1 style="color:green">✅ EMAIL INVIATA CON SUCCESSO!</h1><p>Controlla la casella ' + (process.env.ADMIN_EMAIL || 'info@laperlanera.eu') + '</p><pre>' + JSON.stringify(data) + '</pre>');
    } catch (error) {
        res.send('<h1 style="color:red">❌ ERRORE INVIO EMAIL</h1><pre>' + error.message + '</pre><p>RESEND_API_KEY presente: ' + (process.env.RESEND_API_KEY ? 'Sì' : 'NO - MANCANTE') + '</p>');
    }
});

app.get('/api/debug-env', (req, res) => {
    const relevantKeys = Object.keys(process.env).filter(k =>
        k.includes('RESEND') || k.includes('EMAIL') || k.includes('ADMIN') || k.includes('STRIPE')
    );
    res.json({
        timestamp_richiesta: new Date().toISOString(),
        variabili_trovate: relevantKeys,
        RESEND_API_KEY_esiste: 'RESEND_API_KEY' in process.env,
        RESEND_API_KEY_lunghezza: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.length : 0,
        RESEND_API_KEY_primi_caratteri: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 5) : 'N/D'
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'La Perla Nera Booking System',
        lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : 'Never',
        cachedDates: cachedBookedDates.length,
        cacheValid: lastSyncTime && (Date.now() - lastSyncTime) < CACHE_DURATION,
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        resendConfigured: !!process.env.RESEND_API_KEY
    });
});

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
                <div class="endpoint"><strong>POST /api/sync-calendar</strong><br>Sincronizza il calendario con Airbnb</div>
                <div class="endpoint"><strong>GET /api/calendar</strong><br>Ottieni le date prenotate</div>
                <div class="endpoint"><strong>POST /api/create-payment-intent</strong><br>Crea un pagamento Stripe sicuro</div>
                <div class="endpoint"><strong>POST /api/confirm-booking</strong><br>Conferma la prenotazione e invia le email</div>
                <div class="endpoint"><strong>POST /api/webhook</strong><br>Ricevi conferme pagamento da Stripe</div>
                <div class="endpoint"><strong>GET /api/test-email</strong><br>Test diretto invio email (Resend)</div>
                <div class="endpoint"><strong>GET /api/debug-env</strong><br>Debug variabili ambiente</div>
                <div class="endpoint"><strong>GET /api/status</strong><br>Verifica lo stato del server</div>
                <h2>📊 Info:</h2>
                <ul>
                    <li>Date in cache: <strong>${cachedBookedDates.length}</strong></li>
                    <li>Ultimo sync: <strong>${lastSyncTime ? new Date(lastSyncTime).toLocaleString('it-IT') : 'Mai'}</strong></li>
                    <li>Stripe: <strong>${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Non configurato'}</strong></li>
                    <li>Resend (email): <strong>${process.env.RESEND_API_KEY ? '✅ Configurato' : '❌ Non configurato'}</strong></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint non trovato',
        path: req.path
    });
});

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
    console.log('   POST /api/confirm-booking - Conferma prenotazione e invia email');
    console.log('   POST /api/webhook - Webhook Stripe');
    console.log('   GET  /api/test-email - Test diretto invio email (Resend)');
    console.log('   GET  /api/debug-env - Debug variabili ambiente');
    console.log('   GET  /api/status - Stato del sistema');
    console.log('');
    console.log('⏰ Auto-sync ogni 5 minuti');
    console.log('💾 Cache: 5 minuti');
    console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configurato' : '❌ Mancante'}`);
    console.log(`📧 Resend: ${process.env.RESEND_API_KEY ? '✅ Configurato' : '❌ Mancante'}`);
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n👋 Chiusura server...');
    process.exit(0);
});
