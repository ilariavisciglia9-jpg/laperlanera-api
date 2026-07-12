// ===========================
// SLIDER FUNCTIONALITY
// ===========================
let currentSlide = 0;
const slides = document.querySelectorAll('.slide');
const indicatorsContainer = document.getElementById('sliderIndicators');

// Create indicators
slides.forEach((_, index) => {
    const indicator = document.createElement('div');
    indicator.classList.add('indicator');
    if (index === 0) indicator.classList.add('active');
    indicator.addEventListener('click', () => goToSlide(index));
    indicatorsContainer.appendChild(indicator);
});

const indicators = document.querySelectorAll('.indicator');

function showSlide(n) {
    slides.forEach(slide => slide.classList.remove('active'));
    indicators.forEach(indicator => indicator.classList.remove('active'));
    
    currentSlide = (n + slides.length) % slides.length;
    
    slides[currentSlide].classList.add('active');
    indicators[currentSlide].classList.add('active');
}

function changeSlide(direction) {
    showSlide(currentSlide + direction);
}

function goToSlide(n) {
    showSlide(n);
}

// Auto-advance slides
setInterval(() => {
    changeSlide(1);
}, 5000);

// ===========================
// MOBILE MENU
// ===========================
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');

if (hamburger) {
    hamburger.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        
        // Animate hamburger
        hamburger.classList.toggle('active');
    });

    // Close menu when clicking on a link
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            hamburger.classList.remove('active');
        });
    });
}

// ===========================
// BOOKING FORM VALIDATION
// ===========================
const bookingForm = document.getElementById('bookingForm');

if (bookingForm) {
    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('checkIn').setAttribute('min', today);
    document.getElementById('checkOut').setAttribute('min', today);

    // Update check-out minimum when check-in changes
    document.getElementById('checkIn').addEventListener('change', function() {
        const checkInDate = new Date(this.value);
        checkInDate.setDate(checkInDate.getDate() + 1);
        const minCheckOut = checkInDate.toISOString().split('T')[0];
        document.getElementById('checkOut').setAttribute('min', minCheckOut);
    });

    bookingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = {
            checkIn: document.getElementById('checkIn').value,
            checkOut: document.getElementById('checkOut').value,
            guests: document.getElementById('guests').value,
            rooms: document.getElementById('rooms').value
        };

        // Validate dates
        const checkIn = new Date(formData.checkIn);
        const checkOut = new Date(formData.checkOut);
        
        if (checkOut <= checkIn) {
            alert('La data di check-out deve essere successiva alla data di check-in');
            return;
        }

        // Calculate nights
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        
        // Store booking data in localStorage
        localStorage.setItem('bookingData', JSON.stringify({
            ...formData,
            nights: nights
        }));
        
        // Redirect to booking page
        window.location.href = 'prenotazioni.html';
    });
}

// ===========================
// SCROLL ANIMATIONS
// ===========================
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements for animation
document.addEventListener('DOMContentLoaded', () => {
    const animatedElements = document.querySelectorAll(
        '.showcase-item, .location-card, .benefit-card, .filter-card'
    );
    
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(el);
    });
});

// ===========================
// SMOOTH SCROLL
// ===========================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ===========================
// NAVBAR SCROLL EFFECT
// ===========================
let lastScroll = 0;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 100) {
        navbar.style.boxShadow = '0 5px 30px rgba(0, 71, 171, 0.15)';
    } else {
        navbar.style.boxShadow = '0 2px 20px rgba(0, 71, 171, 0.1)';
    }
    
    lastScroll = currentScroll;
});

// ===========================
// FORM ENHANCEMENTS
// ===========================
document.querySelectorAll('input, select').forEach(element => {
    element.addEventListener('focus', function() {
        this.parentElement.style.transform = 'translateY(-2px)';
    });
    
    element.addEventListener('blur', function() {
        this.parentElement.style.transform = 'translateY(0)';
    });
});

// ===========================
// PRELOAD IMAGES
// ===========================
function preloadImages() {
    const images = [
        'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1920&q=80',
        'https://images.unsplash.com/photo-1531572753322-ad063cecc140?w=1920&q=80',
        'https://images.unsplash.com/photo-1525874684015-58379d421a52?w=1920&q=80',
        'https://images.unsplash.com/photo-1548585744-c0c8b0c1d1e8?w=1920&q=80',
        'https://images.unsplash.com/photo-1529260830199-42c24126f198?w=1920&q=80'
    ];
    
    images.forEach(src => {
        const img = new Image();
        img.src = src;
    });
}

preloadImages();