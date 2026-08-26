// ===========================
// CALENDAR FUNCTIONALITY
// ===========================
let currentDate = new Date();
let selectedCheckIn = null;
let selectedCheckOut = null;

let bookedDates = [];

const API_URL = 'https://laperlanera-api-production.up.railway.app';

let stripe = null;
let elements = null;
let paymentElement = null;

async function initializeStripe() {
    try {
        console.log('🔄 Inizializzazione Stripe...');
        stripe = Stripe('pk_live_51SqquI2K3gdmRVmPCDpGxtA82N4GA93FzoqJ0LG2lO5EHWjaSMp5D5fn9A59oRINvQwDrYJibnF74PaahKDjCiSZ00RNrx82zY');
        console.log('✅ Stripe inizializzato correttamente');
    } catch (error) {
        console.error('❌ Errore inizializzazione Stripe:', error);
    }
}

async function syncWithAirbnb() {
    try {
        console.log('🔄 Sincronizzazione calendario Airbnb...');
        const response = await fetch(`${API_URL}/api/calendar`);
        const data = await response.json();
        
        if (data.success && data.bookedDates) {
            bookedDates = data.bookedDates;
            console.log(`✅ ${bookedDates.length} date prenotate caricate da Airbnb`);
            renderCalendar();
        }
    } catch (error) {
        console.error('❌ Errore sincronizzazione:', error);
        bookedDates = [
            '2026-01-27', '2026-01-28', '2026-01-29',
            '2026-02-14', '2026-02-15', '2026-02-16'
        ];
        console.log('⚠️ Usando date di fallback');
        renderCalendar();
    }
}

const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// ⚠️⚠️⚠️ ATTENZIONE — MODALITÀ TEST ATTIVA ⚠️⚠️⚠️
// I valori "highSeason.price" (sotto) e "cleaningFee" (dentro calcolaPrezzi)
// sono stati abbassati temporaneamente per fare test di prenotazione a 1€.
// PRIMA DI METTERE IL SITO LIVE PER I CLIENTI VERI, CERCA "RIPRISTINARE"
// in questo file (Ctrl+F) e rimetti i valori originali indicati.
const seasonalPrices = {
    weekend: { price: 80 },
    highSeason: {
        price: 1, // RIPRISTINARE: era 120 (rimesso a 1 solo per test 2-3 settembre 2026)
        periods: [
            { start: '06-15', end: '09-15' },
            { start: '12-20', end: '01-06' }
        ]
    },
    midSeason: {
        price: 55,
        periods: [
            { start: '01-07', end: '02-28' }
        ]
    },
    lowSeason: {
        price: 75,
        periods: [
            { start: '03-01', end: '06-14' },
            { start: '09-16', end: '12-19' }
        ]
    }
};

function getPriceForDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateKey = `${month}-${day}`;
    const dayOfWeek = date.getDay();
    
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return seasonalPrices.weekend.price;
    }
    for (const period of seasonalPrices.highSeason.periods) {
        if (isDateInPeriod(dateKey, period.start, period.end, date.getFullYear())) {
            return seasonalPrices.highSeason.price;
        }
    }
    for (const period of seasonalPrices.midSeason.periods) {
        if (isDateInPeriod(dateKey, period.start, period.end, date.getFullYear())) {
            return seasonalPrices.midSeason.price;
        }
    }
    for (const period of seasonalPrices.lowSeason.periods) {
        if (isDateInPeriod(dateKey, period.start, period.end, date.getFullYear())) {
            return seasonalPrices.lowSeason.price;
        }
    }
    return seasonalPrices.lowSeason.price;
}

function isDateInPeriod(dateKey, periodStart, periodEnd, year) {
    if (periodStart > periodEnd) {
        return dateKey >= periodStart || dateKey <= periodEnd;
    } else {
        return dateKey >= periodStart && dateKey <= periodEnd;
    }
}

function calculateTotalPrice(checkInDate, checkOutDate) {
    let totalPrice = 0;
    const current = new Date(checkInDate);
    while (current < checkOutDate) {
        totalPrice += getPriceForDate(current);
        current.setDate(current.getDate() + 1);
    }
    return totalPrice;
}

function getAveragePricePerNight(checkInDate, checkOutDate) {
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const totalPrice = calculateTotalPrice(checkInDate, checkOutDate);
    return Math.round(totalPrice / nights);
}

function calcolaPrezzi() {
    if (!selectedCheckIn || !selectedCheckOut) return null;

    const nights = Math.ceil((selectedCheckOut - selectedCheckIn) / (1000 * 60 * 60 * 24));
    const subtotal = calculateTotalPrice(selectedCheckIn, selectedCheckOut);
    const cleaningFee = 0; // RIPRISTINARE: era 20 (rimesso a 30 solo per test)

    const adults = parseInt(document.getElementById('adults') ? document.getElementById('adults').value : 2) || 2;
    const children = parseInt(document.getElementById('children') ? document.getElementById('children').value : 0) || 0;
    const totalPersone = adults + children;

    const tax = totalPersone * 3.5 * nights;

    const extraGuests = Math.max(0, adults - 2);
    const extraGuestFee = extraGuests * 10 * nights;

    const total = subtotal + cleaningFee + tax + extraGuestFee;

    return { nights, subtotal, cleaningFee, tax, extraGuests, extraGuestFee, total, adults, children, totalPersone };
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const currentMonthEl = document.getElementById('currentMonth');
    if (!currentMonthEl) return;
    currentMonthEl.textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const calendarDaysContainer = document.getElementById('calendarDays');
    if (!calendarDaysContainer) return;
    calendarDaysContainer.innerHTML = '';
    
    dayNames.forEach(day => {
        const dayName = document.createElement('div');
        dayName.className = 'calendar-day-name';
        dayName.textContent = day;
        calendarDaysContainer.appendChild(dayName);
    });
    
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day disabled';
        calendarDaysContainer.appendChild(emptyDay);
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        dayElement.textContent = day;
        
        const currentDayDate = new Date(year, month, day);
        const dateString = formatDate(currentDayDate);
        
        if (currentDayDate < today) {
            dayElement.classList.add('disabled');
        } else if (bookedDates.includes(dateString)) {
            dayElement.classList.add('booked');
        } else if ((selectedCheckIn && dateString === formatDate(selectedCheckIn)) ||
                   (selectedCheckOut && dateString === formatDate(selectedCheckOut))) {
            dayElement.classList.add('selected');
        } else if (selectedCheckIn && selectedCheckOut &&
                   currentDayDate > selectedCheckIn && currentDayDate < selectedCheckOut) {
            dayElement.classList.add('in-range');
        }
        
        if (!dayElement.classList.contains('disabled') && !dayElement.classList.contains('booked')) {
            dayElement.addEventListener('click', () => selectDate(currentDayDate));
        }
        
        calendarDaysContainer.appendChild(dayElement);
    }
}

function selectDate(date) {
    if (!selectedCheckIn || (selectedCheckIn && selectedCheckOut)) {
        selectedCheckIn = date;
        selectedCheckOut = null;
    } else if (date > selectedCheckIn) {
        if (!hasBookedDatesInRange(selectedCheckIn, date)) {
            selectedCheckOut = date;
        } else {
            alert('Il periodo selezionato include date già prenotate. Scegli altre date.');
            return;
        }
    } else {
        selectedCheckIn = date;
        selectedCheckOut = null;
    }
    
    renderCalendar();
    updateBookingSummary();

    if (selectedCheckIn && selectedCheckOut) {
        const paymentInput = document.querySelector('input[name="payment"]:checked');
        const currentMethod = paymentInput ? paymentInput.value : 'card';
        if (currentMethod === 'card') {
            avviaPagamentoCarta();
        }
    }
}

function updateBookingSummary() {
    if (!selectedCheckIn || !selectedCheckOut) {
        document.getElementById('summaryCheckIn').textContent = 'Seleziona date';
        document.getElementById('summaryCheckOut').textContent = 'Seleziona date';
        document.getElementById('summaryNights').textContent = '0';
        document.getElementById('priceNights').textContent = '0';
        document.getElementById('priceSubtotal').textContent = '€0';
        document.getElementById('priceTax').textContent = '€0';
        document.getElementById('priceTotal').textContent = '€0';
        const extraRow = document.getElementById('extraGuestRow');
        if (extraRow) extraRow.remove();
        return;
    }

    const p = calcolaPrezzi();
    if (!p) return;

    document.getElementById('summaryCheckIn').textContent = formatDisplayDate(selectedCheckIn);
    document.getElementById('summaryCheckOut').textContent = formatDisplayDate(selectedCheckOut);
    document.getElementById('summaryNights').textContent = p.nights;
    document.getElementById('priceNights').textContent = p.nights;
    document.getElementById('priceSubtotal').textContent = '€' + p.subtotal;
    document.getElementById('priceTax').textContent = `€${p.tax.toFixed(2)}`;
    document.getElementById('priceTotal').textContent = '€' + p.total.toFixed(2);

    let extraRow = document.getElementById('extraGuestRow');
    if (p.extraGuests > 0) {
        if (!extraRow) {
            extraRow = document.createElement('div');
            extraRow.id = 'extraGuestRow';
            extraRow.className = 'price-row';
            document.querySelector('.price-breakdown').appendChild(extraRow);
        }
        extraRow.innerHTML = `<span>Ospiti aggiuntivi (${p.extraGuests} x €10 x ${p.nights} notti)</span><strong>€${p.extraGuestFee}</strong>`;
    } else {
        if (extraRow) extraRow.remove();
    }
}

function hasBookedDatesInRange(start, end) {
    const current = new Date(start);
    current.setDate(current.getDate() + 1);
    while (current < end) {
        if (bookedDates.includes(formatDate(current))) {
            return true;
        }
        current.setDate(current.getDate() + 1);
    }
    return false;
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
    const day = date.getDate();
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

function previousMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
}

function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
}

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.payment-method').forEach(method => {
        method.addEventListener('click', function() {
            document.querySelectorAll('.payment-method').forEach(m => {
                m.classList.remove('selected');
            });
            this.classList.add('selected');
            this.querySelector('input[type="radio"]').checked = true;
            const value = this.querySelector('input[type="radio"]').value;
            console.log('💳 Metodo di pagamento selezionato:', value);

            if (value === 'card') {
                avviaPagamentoCarta();
            }
        });
    });
});

async function avviaPagamentoCarta() {
    if (elements) return;

    if (!selectedCheckIn || !selectedCheckOut) {
        alert('Per favore seleziona prima le date di check-in e check-out dal calendario.');
        return;
    }

    const p = calcolaPrezzi();
    if (!p) return;

    try {
        console.log('💳 Creazione Payment Intent...');

        const amountInCents = Math.round(parseFloat(p.total) * 100);
        console.log(`💰 Importo: €${p.total} → ${amountInCents} centesimi`);

        const bookingDataPreview = {
            checkIn: formatDate(selectedCheckIn),
            checkOut: formatDate(selectedCheckOut),
            nights: p.nights,
            adults: p.adults,
            children: p.children,
            total: p.total.toFixed(2)
        };

        const paymentResponse = await fetch(`${API_URL}/api/create-payment-intent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amountInCents,
                currency: 'eur',
                bookingData: bookingDataPreview
            })
        });

        const paymentData = await paymentResponse.json();
        console.log('📦 Risposta server:', JSON.stringify(paymentData));

        if (!paymentData.clientSecret) {
            throw new Error('Errore nella creazione del pagamento: ' + (paymentData.error || paymentData.details || 'sconosciuto'));
        }

        elements = stripe.elements({ clientSecret: paymentData.clientSecret });
        paymentElement = elements.create('payment');

        const container = document.getElementById('payment-element-container');
        if (container) container.style.display = 'block';

        setTimeout(() => {
            paymentElement.mount('#payment-element');
            paymentElement.on('ready', () => {
                console.log('✅ Form pagamento pronto');
                if (container) container.scrollIntoView({ behavior: 'smooth' });
            });
        }, 50);

    } catch (error) {
        console.error('❌ Errore:', error);
        alert('Si è verificato un errore nella preparazione del pagamento: ' + error.message + '\n\nRiprova o contattaci.');
    }
}

function updateGuestsSummary() {
    const adults = document.getElementById('adults') ? document.getElementById('adults').value : '2';
    const children = document.getElementById('children') ? document.getElementById('children').value : '0';
    
    let guestText = `${adults} ${adults == 1 ? 'adulto' : 'adulti'}`;
    if (children > 0) {
        guestText += `, ${children} ${children == 1 ? 'bambino' : 'bambini'}`;
    }
    
    const summaryGuestsEl = document.getElementById('summaryGuests');
    if (summaryGuestsEl) {
        summaryGuestsEl.textContent = guestText;
    }

    updateBookingSummary();
}

document.addEventListener('DOMContentLoaded', function() {
    const adultsSelect = document.getElementById('adults');
    const childrenSelect = document.getElementById('children');
    
    if (adultsSelect) {
        adultsSelect.addEventListener('change', updateGuestsSummary);
    }
    if (childrenSelect) {
        childrenSelect.addEventListener('change', updateGuestsSummary);
    }
});

const completeBookingForm = document.getElementById('completeBookingForm');

if (completeBookingForm) {
    completeBookingForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (!selectedCheckIn || !selectedCheckOut) {
            alert('Per favore seleziona le date di check-in e check-out dal calendario.');
            return;
        }

        const p = calcolaPrezzi();
        if (!p) return;

        const paymentInput = document.querySelector('input[name="payment"]:checked');
        const paymentMethod = paymentInput ? paymentInput.value : 'card';

        const bookingData = {
            checkIn: formatDate(selectedCheckIn),
            checkOut: formatDate(selectedCheckOut),
            nights: p.nights,
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            country: document.getElementById('country').value,
            adults: p.adults,
            children: p.children,
            arrivalTime: document.getElementById('arrivalTime').value,
            specialRequests: document.getElementById('specialRequests').value,
            subtotal: p.subtotal.toFixed(2),
            cleaningFee: p.cleaningFee.toFixed(2),
            extraGuestFee: p.extraGuestFee.toFixed(2),
            tax: p.tax.toFixed(2),
            total: p.total.toFixed(2),
            paymentMethod: paymentMethod,
            timestamp: new Date().toISOString()
        };

  try {
    if (paymentMethod === 'transfer' || paymentMethod === 'paypal') {
        console.log('📨 Invio prenotazione con pagamento: ' + paymentMethod);

        const bookingResponse = await fetch(`${API_URL}/api/confirm-booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        const confirmData = await bookingResponse.json();

        if (confirmData.success) {
            window.lastEmailStatus = confirmData.emailStatus || 'N/D';
            showBookingSuccess(confirmData.bookingId, paymentMethod);
        } else {
            alert('Si è verificato un errore nella prenotazione. Riprova o contattaci.');
        }
        return;
    }

    if (elements) {
        console.log('🔄 Conferma pagamento...');
        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
            confirmParams: {
                return_url: window.location.href,
            }
        });

        if (error) {
            alert('Errore nel pagamento: ' + error.message);
            return;
        }

        if (paymentIntent && paymentIntent.status === 'succeeded') {
            await completaPrenotazione(bookingData, paymentIntent);
        }
        return;
    }

    await avviaPagamentoCarta();
    return;

    } catch (error) {
        console.error('❌ Errore:', error);
        alert('Si è verificato un errore: ' + error.message + '\n\nRiprova o contattaci.');
    }

    });
}

function showBookingSuccess(bookingId, paymentMethod) {
    const box = document.getElementById('booking-success-message');
    if (!box) {
        alert('✅ Prenotazione inviata! Codice: ' + bookingId + '\nStato email: ' + (window.lastEmailStatus || 'N/D'));
        return;
    }

    let extra = '';
    if (paymentMethod === 'transfer') {
        extra = 'Completa il bonifico entro 48 ore usando le coordinate indicate sopra per confermare definitivamente la prenotazione.';
    } else if (paymentMethod === 'paypal') {
        extra = 'Invia il pagamento a mingrone.danny@gmail.com e mandaci lo screenshot della ricevuta per confermare definitivamente la prenotazione.';
    }

    box.innerHTML = '✅ <strong>Prenotazione inviata!</strong><br>Codice prenotazione: <strong>' + bookingId + '</strong><br>📧 Stato email: <strong>' + (window.lastEmailStatus || 'N/D') + '</strong><br>' + extra;
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth' });

    if (completeBookingForm) {
        const submitBtn = completeBookingForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
    }
}

async function completaPrenotazione(bookingData, paymentIntent) {
    try {
        const bookingResponse = await fetch(`${API_URL}/api/confirm-booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        const confirmData = await bookingResponse.json();

        if (confirmData.success) {
            window.lastEmailStatus = confirmData.emailStatus || 'N/D';
            alert('✅ PRENOTAZIONE CONFERMATA!\n\nCodice: ' + confirmData.bookingId + '\n\n📧 Stato email: ' + window.lastEmailStatus);
        } else {
            alert('Pagamento completato ma errore nella conferma. Contattaci con ID: ' + paymentIntent.id);
        }
    } catch (error) {
        alert('Pagamento completato ma errore nella conferma. Contattaci con ID: ' + paymentIntent.id);
    }
}

window.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Inizializzazione pagina prenotazioni...');
    
    await initializeStripe();
    
    const savedBooking = localStorage.getItem('bookingData');
    if (savedBooking) {
        const data = JSON.parse(savedBooking);
        if (data.checkIn && data.checkOut) {
            selectedCheckIn = new Date(data.checkIn);
            selectedCheckOut = new Date(data.checkOut);
            currentDate = new Date(selectedCheckIn);
        }
        if (data.guests && document.getElementById('adults')) {
            document.getElementById('adults').value = data.guests;
        }
        localStorage.removeItem('bookingData');
    }
    
    await syncWithAirbnb();
    renderCalendar();
    
    console.log('✅ Pagina pronta!');
});
