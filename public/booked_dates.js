// ===========================
// SHARED BOOKED DATES
// ===========================
// Questo file contiene le date prenotate condivise tra homepage e pagina prenotazioni
// IMPORTANTE: Aggiorna questo file quando ricevi nuove prenotazioni da Airbnb

// Date prenotate - FORMATO: 'YYYY-MM-DD'
const BOOKED_DATES = [
    // Gennaio 2025
    '2025-01-20', '2025-01-21', '2025-01-22', '2025-01-23', '2025-01-24',
    '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30',
    
    // Febbraio 2025 (San Valentino)
    '2025-02-13', '2025-02-14', '2025-02-15', '2025-02-16', '2025-02-17',
    '2025-02-21', '2025-02-22', '2025-02-23',
    
    // Marzo 2025 (Pasqua)
    '2025-03-14', '2025-03-15', '2025-03-16',
    '2025-03-20', '2025-03-21', '2025-03-22', '2025-03-23', '2025-03-24',
    
    // AGGIUNGI QUI LE NUOVE DATE QUANDO RICEVI PRENOTAZIONI
    // Esempio: '2025-04-10', '2025-04-11', '2025-04-12'
];

// Funzione helper per controllare se una data è prenotata
function isDateBooked(dateString) {
    return BOOKED_DATES.includes(dateString);
}

// Funzione helper per controllare se un periodo ha date prenotate
function hasBookedDatesInPeriod(checkInDate, checkOutDate) {
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    let current = new Date(checkIn);
    
    while (current < checkOut) {
        const dateString = current.toISOString().split('T')[0];
        if (isDateBooked(dateString)) {
            return {
                hasConflict: true,
                conflictDate: dateString
            };
        }
        current.setDate(current.getDate() + 1);
    }
    
    return {
        hasConflict: false,
        conflictDate: null
    };
}

// Esporta per uso in altri file
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BOOKED_DATES,
        isDateBooked,
        hasBookedDatesInPeriod
    };
}
