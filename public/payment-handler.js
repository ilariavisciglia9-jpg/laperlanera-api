// ===========================
// STRIPE PAYMENT INTEGRATION
// ===========================

// IMPORTANTE: La chiave pubblica Stripe è sicura da mostrare nel frontend
// La chiave SEGRETA rimane SOLO sul server (server.js)

// Chiave pubblica Stripe (è SICURA mostrarla qui)
const STRIPE_PUBLIC_KEY = 'pk_live_51SqquI2K3gdmRVmPCDpGxtA82N4GA93FzoqJ0LG2lO5EHWjaSMp5D5fn9A59oRINvQwDrYJibnF74PaahKDjCiSZ00RNrx82zY';

// URL del tuo server API
const API_URL = 'https://laperlanera-api-production.up.railway.app';

// Inizializza Stripe con la chiave PUBBLICA
const stripe = Stripe(STRIPE_PUBLIC_KEY);

// Elementi per la carta
let cardElement;

// Inizializza il form di pagamento quando la pagina è pronta
document.addEventListener('DOMContentLoaded', function() {
    initializeStripeElements();
    setupPaymentMethodSelection();
    
    // Aggiungi listener al form
    const form = document.getElementById('completeBookingForm');
    if (form) {
        form.addEventListener('submit', handlePaymentSubmit);
    }
});

// ===========================
// INIZIALIZZA STRIPE ELEMENTS
// ===========================
function initializeStripeElements() {
    const elements = stripe.elements();
    
    // Crea l'elemento carta con stile personalizzato La Perla Nera
    cardElement = elements.create('card', {
        style: {
            base: {
                fontSize: '16px',
                color: '#1a1a1a',
                fontFamily: '"Montserrat", sans-serif',
                '::placeholder': {
                    color: '#999'
                },
                lineHeight: '48px',
                padding: '12px'
            },
            invalid: {
                color: '#8B0000',
                iconColor: '#8B0000'
            }
        },
        hidePostalCode: true
    });
    
    // Monta l'elemento nel DOM
    const cardElementContainer = document.getElementById('card-element');
    if (cardElementContainer) {
        cardElement.mount('#card-element');
        
        // Gestisci errori di validazione in tempo reale
        cardElement.on('change', function(event) {
            const displayError = document.getElementById('card-errors');
            if (event.error) {
                displayError.textContent = event.error.message;
                displayError.style.display = 'block';
            } else {
                displayError.textContent = '';
                displayError.style.display = 'none';
            }
        });
    }
}

// ===========================
// SELEZIONE METODO DI PAGAMENTO
// ===========================
function setupPaymentMethodSelection() {
    const paymentMethods = document.querySelectorAll('.payment-method');
    const stripeSection = document.getElementById('stripe-payment-section');
    const transferInfo = document.getElementById('transfer-info');
    
    paymentMethods.forEach(method => {
        method.addEventListener('click', function() {
            // Rimuovi selezione da tutti
            paymentMethods.forEach(m => m.classList.remove('selected'));
            
            // Aggiungi selezione a quello cliccato
            this.classList.add('selected');
            const radio = this.querySelector('input[type="radio"]');
            radio.checked = true;
            
            // Mostra/nascondi sezione appropriata
            const paymentType = radio.value;
            
            if (paymentType === 'card') {
                stripeSection.style.display = 'block';
                if (transferInfo) transferInfo.style.display = 'none';
            } else if (paymentType === 'transfer') {
                stripeSection.style.display = 'none';
                if (transferInfo) transferInfo.style.display = 'block';
            } else {
                stripeSection.style.display = 'none';
                if (transferInfo) transferInfo.style.display = 'none';
            }
        });
    });
}

// ===========================
// GESTIONE SUBMIT FORM
// ===========================
async function handlePaymentSubmit(event) {
    event.preventDefault();
    
    // Valida che le date siano selezionate
    if (!selectedCheckIn || !selectedCheckOut) {
        showAlert('⚠️ Attenzione', 'Per favore seleziona le date di check-in e check-out dal calendario.');
        return;
    }
    
    // Ottieni il metodo di pagamento selezionato
    const paymentMethod = document.querySelector('input[name="payment"]:checked');
    if (!paymentMethod) {
        showAlert('⚠️ Attenzione', 'Seleziona un metodo di pagamento.');
        return;
    }
    
    // Raccogli i dati del form
    const bookingData = collectBookingData();
    
    // Gestisci in base al metodo di pagamento
    if (paymentMethod.value === 'card') {
        await processStripePayment(bookingData);
    } else if (paymentMethod.value === 'transfer') {
        processTransferPayment(bookingData);
    } else {
        showAlert('⚠️ Attenzione', 'Metodo di pagamento non ancora disponibile. Seleziona Carta o Bonifico.');
    }
}

// ===========================
// RACCOGLI DATI PRENOTAZIONE
// ===========================
function collectBookingData() {
    const nights = Math.ceil((selectedCheckOut - selectedCheckIn) / (1000 * 60 * 60 * 24));
    
    // Calcola il prezzo totale
    const subtotal = calculateTotalPrice(selectedCheckIn, selectedCheckOut);
    const cleaningFee = 50;
    const tax = nights * 3.5;
    const total = subtotal + cleaningFee + tax;
    
    return {
        checkIn: formatDate(selectedCheckIn),
        checkOut: formatDate(selectedCheckOut),
        nights: nights,
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        country: document.getElementById('country').value,
        adults: document.getElementById('adults').value,
        children: document.getElementById('children').value || 0,
        arrivalTime: document.getElementById('arrivalTime').value,
        specialRequests: document.getElementById('specialRequests').value,
        subtotal: subtotal,
        cleaningFee: cleaningFee,
        tax: tax,
        total: total.toFixed(2)
    };
}

// ===========================
// ELABORA PAGAMENTO STRIPE
// ===========================
async function processStripePayment(bookingData) {
    const submitButton = document.querySelector('#completeBookingForm button[type="submit"]');
    const originalButtonText = submitButton.innerHTML;
    
    try {
        // Disabilita il pulsante e mostra loading
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="spinner"></span> Elaborazione pagamento...';
        
        console.log('💳 Creazione pagamento Stripe...');
        
        // 1. Crea il Payment Intent sul SERVER (SICURO)
        const amount = Math.round(parseFloat(bookingData.total) * 100); // Converti in centesimi
        
        const response = await fetch(`${API_URL}/api/create-payment-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                currency: 'eur',
                bookingData: bookingData
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Errore nella creazione del pagamento');
        }
        
        const { clientSecret } = await response.json();
        console.log('✅ Payment Intent creato');
        
        // 2. Conferma il pagamento con Stripe
        console.log('🔐 Conferma pagamento...');
        const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card: cardElement,
                billing_details: {
                    name: `${bookingData.firstName} ${bookingData.lastName}`,
                    email: bookingData.email,
                    phone: bookingData.phone
                }
            }
        });
        
        if (error) {
            throw new Error(error.message);
        }
        
        if (paymentIntent.status === 'succeeded') {
            console.log('✅ Pagamento completato!');
            showPaymentSuccess(bookingData, paymentIntent.id);
        }
        
    } catch (error) {
        console.error('❌ Errore pagamento:', error);
        showAlert(
            '❌ Errore Pagamento', 
            `Si è verificato un errore:\n${error.message}\n\nRiprova o contattaci per assistenza:\ninfo@laperlanera.eu`
        );
    } finally {
        // Riabilita il pulsante
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
    }
}

// ===========================
// ELABORA PAGAMENTO BONIFICO
// ===========================
function processTransferPayment(bookingData) {
    // Salva i dati della prenotazione
    localStorage.setItem('lastBooking', JSON.stringify(bookingData));
    
    // Mostra istruzioni per il bonifico
    showAlert(
        '✅ Prenotazione Registrata!',
        `📋 Dettagli prenotazione:\n` +
        `Check-in: ${formatDisplayDate(selectedCheckIn)}\n` +
        `Check-out: ${formatDisplayDate(selectedCheckOut)}\n` +
        `Totale: €${bookingData.total}\n\n` +
        `💳 ISTRUZIONI PER IL BONIFICO:\n\n` +
        `Intestatario: La Perla Nera\n` +
        `IBAN: IT60X0542404294000000123456\n` +
        `Causale: Prenotazione ${bookingData.firstName} ${bookingData.lastName} - ${formatDate(selectedCheckIn)}\n` +
        `Importo: €${bookingData.total}\n\n` +
        `⚠️ IMPORTANTE:\n` +
        `Effettua il bonifico entro 48 ore per confermare la prenotazione.\n\n` +
        `Riceverai una email di conferma a ${bookingData.email} con tutti i dettagli.\n\n` +
        `Grazie per aver scelto La Perla Nera!`
    );
    
    console.log('📧 Prenotazione con bonifico registrata:', bookingData);
    
    // TODO: Invia email con istruzioni bonifico
}

// ===========================
// MOSTRA SUCCESSO PAGAMENTO
// ===========================
function showPaymentSuccess(bookingData, paymentId) {
    // Salva i dati
    localStorage.setItem('lastBooking', JSON.stringify({
        ...bookingData,
        paymentId: paymentId,
        paymentStatus: 'paid',
        paymentDate: new Date().toISOString()
    }));
    
    // Mostra messaggio di successo
    showAlert(
        '✅ Pagamento Completato!',
        `🎉 La tua prenotazione è confermata!\n\n` +
        `📋 Dettagli:\n` +
        `Check-in: ${formatDisplayDate(selectedCheckIn)}\n` +
        `Check-out: ${formatDisplayDate(selectedCheckOut)}\n` +
        `Totale pagato: €${bookingData.total}\n\n` +
        `🔑 ID Pagamento: ${paymentId}\n\n` +
        `Riceverai una email di conferma a ${bookingData.email} con tutti i dettagli e le istruzioni per il check-in.\n\n` +
        `Grazie per aver scelto La Perla Nera!`
    );
    
    console.log('✅ Pagamento completato:', {
        bookingData: bookingData,
        paymentId: paymentId
    });
    
    // TODO: Reindirizza a pagina di conferma
    // setTimeout(() => {
    //     window.location.href = 'conferma.html?booking=' + paymentId;
    // }, 3000);
}

// ===========================
// UTILITY: MOSTRA ALERT
// ===========================
function showAlert(title, message) {
    // Puoi personalizzare questo con un modal più carino
    alert(`${title}\n\n${message}`);
}

// ===========================
// AGGIUNGI SPINNER CSS
// ===========================
const style = document.createElement('style');
style.textContent = `
    .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid #ffffff;
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 0.6s linear infinite;
        margin-right: 8px;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    #card-errors {
        color: #8B0000;
        font-size: 14px;
        margin-top: 10px;
        display: none;
    }
`;
document.head.appendChild(style);