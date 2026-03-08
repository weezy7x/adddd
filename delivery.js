// ===================================
// Delivery System - My Flowers
// ===================================

const DeliverySystem = {
    normalizeCheckoutUrl(checkoutUrl) {
        if (!checkoutUrl || typeof checkoutUrl !== 'string') return checkoutUrl;

        const trimmed = checkoutUrl.trim();
        if (!trimmed) return trimmed;

        const shopifyDomain = 'https://myflowers-secours.myshopify.com';

        if (/^https?:\/\//i.test(trimmed)) {
            try {
                const url = new URL(trimmed);
                if (url.hostname === 'myflowers-shop.fr' || url.hostname === 'www.myflowers-shop.fr') {
                    return `${shopifyDomain}${url.pathname}${url.search}${url.hash}`;
                }
                return trimmed;
            } catch {
                return trimmed;
            }
        }

        if (trimmed.startsWith('//')) {
            try {
                const url = new URL(`https:${trimmed}`);
                if (url.hostname === 'myflowers-shop.fr' || url.hostname === 'www.myflowers-shop.fr') {
                    return `${shopifyDomain}${url.pathname}${url.search}${url.hash}`;
                }
                return `https:${trimmed}`;
            } catch {
                return `https:${trimmed}`;
            }
        }

        if (trimmed.startsWith('/')) {
            return `${shopifyDomain}${trimmed}`;
        }

        return `${shopifyDomain}/${trimmed.replace(/^\/+/, '')}`;
    },

    // Configuration
    config: {
        shopAddress: '21 Rue Lafayette, 57000 Metz, France',
        shopLat: 49.1197,
        shopLng: 6.1744,
        maxLocalDistance: 50, // km max pour livraison locale (par route)
        
        // Tarifs livraison locale (par leurs soins)
        localPricing: [
            { maxKm: 10, price: 0, label: 'Gratuit' },
            { maxKm: 35, price: 10, label: '10,00 €' },
            { maxKm: 50, price: 20, label: '20,00 €' }
        ],
        
        // Tarifs France (GLS)
        francePricing: {
            domicile: { price: 15, label: '15,00 €' },
            relais: { price: 10, label: '10,00 €' }
        },
        
        // Retrait en boutique
        pickupPrice: 0
    },

    // State
    selectedMode: null,       // 'local', 'france', 'pickup'
    selectedSubMode: null,    // 'domicile', 'relais' (for france)
    deliveryAddress: '',
    deliveryDistance: null,
    deliveryPrice: null,
    selectedDate: null,
    cartSubtotal: 0,
    unavailableDates: [],       // Dates where local delivery is unavailable
    unavailablePickupDates: [], // Dates where pickup is unavailable
    currentCalendarMonth: new Date().getMonth(),
    currentCalendarYear: new Date().getFullYear(),

    // ===================================
    // Initialize
    // ===================================
    init() {
        this.loadUnavailableDates();
        this.createDeliveryPanel();
        this.bindEvents();
    },

    // ===================================
    // Load Unavailable Dates from Backend
    // ===================================
    async loadUnavailableDates() {
        try {
            // Load delivery unavailable dates
            const deliveryResponse = await fetch('https://myflowers-shop.fr/api/delivery/unavailable-dates');
            if (deliveryResponse.ok) {
                const deliveryData = await deliveryResponse.json();
                this.unavailableDates = deliveryData.unavailableDates || [];
            }
            
            // Load pickup unavailable dates
            const pickupResponse = await fetch('https://myflowers-shop.fr/api/pickup/unavailable-dates');
            if (pickupResponse.ok) {
                const pickupData = await pickupResponse.json();
                this.unavailablePickupDates = pickupData.unavailableDates || [];
            }
            
        } catch (error) {
            console.warn('Could not load unavailable dates:', error);
            this.unavailableDates = [];
            this.unavailablePickupDates = [];
        }
    },

    // ===================================
    // Check if date is available
    // ===================================
    isDateAvailable(dateStr) {
        // Check appropriate unavailable dates based on current mode
        if (this.selectedMode === 'local') {
            return !this.unavailableDates.includes(dateStr);
        } else if (this.selectedMode === 'pickup') {
            return !this.unavailablePickupDates.includes(dateStr);
        }
        return true; // If no mode selected, all dates available
    },

    // ===================================
    // Render Custom Calendar
    // ===================================
    renderCalendar() {
        const grid = document.getElementById('calendarDaysGrid');
        if (!grid) return;

        const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                           'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        
        // Update header
        const monthYearEl = document.getElementById('calendarMonthYear');
        if (monthYearEl) {
            monthYearEl.textContent = `${monthNames[this.currentCalendarMonth]} ${this.currentCalendarYear}`;
        }

        // Get first day of month and number of days
        const firstDay = new Date(this.currentCalendarYear, this.currentCalendarMonth, 1);
        const lastDay = new Date(this.currentCalendarYear, this.currentCalendarMonth + 1, 0);
        const numDays = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        
        // Adjust for Monday start (0 = Monday, 6 = Sunday)
        const adjustedStartDay = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        grid.innerHTML = '';

        // Add empty cells for days before month starts
        for (let i = 0; i < adjustedStartDay; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'calendar-day empty';
            grid.appendChild(emptyCell);
        }

        // Add days of month
        for (let day = 1; day <= numDays; day++) {
            const date = new Date(this.currentCalendarYear, this.currentCalendarMonth, day);
            const dateStr = this.formatDateToISO(date);
            const isPast = date < today;
            const isSunday = date.getDay() === 0;
            // Check unavailable dates for local delivery OR pickup
            const isUnavailable = (this.selectedMode === 'local' || this.selectedMode === 'pickup') && !this.isDateAvailable(dateStr);
            const isSelected = this.selectedDate === dateStr;
            const isToday = date.getTime() === today.getTime();

            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            dayCell.textContent = day;

            if (isToday) dayCell.classList.add('today');
            if (isSelected) dayCell.classList.add('selected');
            
            // Disable past dates, Sundays, or unavailable dates
            if (isPast || isSunday || isUnavailable) {
                dayCell.classList.add('disabled');
                if (isSunday) dayCell.title = 'Fermé le dimanche';
                if (isUnavailable) {
                    dayCell.title = 'Date indisponible';
                }
            } else {
                dayCell.classList.add('available');
                dayCell.addEventListener('click', () => {
                    this.selectDate(dateStr);
                });
            }

            grid.appendChild(dayCell);
        }
    },

    formatDateToISO(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    selectDate(dateStr) {
        this.selectedDate = dateStr;
        const hiddenInput = document.getElementById('deliveryDateInput');
        if (hiddenInput) hiddenInput.value = dateStr;
        this.renderCalendar(); // Re-render to show selection
        this.validateDate();
        this.updateSummary();
    },

    // ===================================
    // Create Delivery Panel HTML
    // ===================================
    createDeliveryPanel() {
        if (document.getElementById('deliveryOverlay')) return;

        const today = new Date();
        const minDate = new Date(today);
        minDate.setDate(minDate.getDate() + 1); // minimum demain pour France/international
        const minDateLocal = today.toISOString().split('T')[0]; // aujourd'hui pour retrait
        const minDateStr = minDate.toISOString().split('T')[0];
        const maxDate = new Date(today);
        maxDate.setMonth(maxDate.getMonth() + 2);
        const maxDateStr = maxDate.toISOString().split('T')[0];

        const overlay = document.createElement('div');
        overlay.id = 'deliveryOverlay';
        overlay.className = 'delivery-overlay';
        overlay.innerHTML = `
            <div class="delivery-backdrop"></div>
            <div class="delivery-panel">
                <div class="delivery-panel-header">
                    <button class="delivery-mobile-back"><i class="fas fa-arrow-left"></i> Retour</button>
                    <h3><i class="fas fa-truck"></i> Options de livraison</h3>
                    <span class="delivery-header-spacer"></span>
                    <button class="delivery-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="delivery-panel-body">
                    <div class="delivery-steps">
                        <div class="delivery-step-indicator active" data-step="1">
                            <span class="step-num">1</span>
                            <span>Mode</span>
                        </div>
                        <div class="step-connector"></div>
                        <div class="delivery-step-indicator" data-step="2">
                            <span class="step-num">2</span>
                            <span>Date</span>
                        </div>
                        <div class="step-connector"></div>
                        <div class="delivery-step-indicator" data-step="3">
                            <span class="step-num">3</span>
                            <span>Récap</span>
                        </div>
                    </div>

                    <div class="delivery-options">
                        <div class="delivery-option" data-mode="local">
                            <div class="delivery-option-radio"></div>
                            <div class="delivery-option-content">
                                <h4>
                                    <i class="fas fa-motorcycle"></i>
                                    Livraison par My Flowers
                                </h4>
                                <p>Livraison par nos soins dans un rayon de 50 km autour de Metz. Gratuit dans le secteur de Metz !</p>
                            </div>
                            <div class="delivery-option-price free">Dès 0 €</div>
                        </div>

                        <div class="delivery-option" data-mode="france">
                            <div class="delivery-option-radio"></div>
                            <div class="delivery-option-content">
                                <h4>
                                    <i class="fas fa-shipping-fast"></i>
                                    Livraison France (GLS)
                                    <span class="delivery-badge express" title="Délai compté à partir de l'expédition du colis">24-48h après expédition*</span>
                                </h4>
                                <p>Livraison partout en France métropolitaine.</p>
                                <p style="font-size:0.75rem;color:#999;margin-top:0.25rem;margin-bottom:0;">*Hors week-ends et jours fériés</p>
                                <div class="gls-suboptions" id="glsSuboptions">
                                    <label class="gls-suboption selected" data-sub="domicile">
                                        <input type="radio" name="glsMode" value="domicile" checked>
                                        <span><strong>À domicile</strong> — 15,00 €</span>
                                    </label>
                                    <label class="gls-suboption" data-sub="relais">
                                        <input type="radio" name="glsMode" value="relais">
                                        <span><strong>Point relais</strong> — 10,00 €</span>
                                    </label>
                                </div>
                                <div id="relaisInfoMessage" style="display: none; background: #E3F2FD; border-left: 4px solid #2196F3; padding: 0.75rem; border-radius: 4px; margin-top: 0.75rem; font-size: 0.85rem; color: #1565C0;">
                                    <i class="fas fa-info-circle"></i> <strong>Le choix du point relais se fait après paiement.</strong>
                                </div>
                                <div class="gls-address-section" id="glsAddressSection" style="display: none; margin-top: 1rem;">
                                    <label style="font-size: 0.9rem; font-weight: 600; color: #5A5A5A; display: block; margin-bottom: 0.5rem;">
                                        <i class="fas fa-map-marker-alt"></i> Adresse de livraison
                                    </label>
                                    <input type="text" id="glsAddressName" placeholder="Nom complet" style="width: 100%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; margin-bottom: 0.5rem; font-family: inherit;">
                                    <input type="text" id="glsAddressStreet" placeholder="Adresse (numéro et rue)" style="width: 100%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; margin-bottom: 0.5rem; font-family: inherit;">
                                    <div id="glsAddressSuggestions" style="display: none; position: absolute; background: white; border: 1px solid #E0E0E0; border-top: none; border-radius: 0 0 8px 8px; max-height: 200px; overflow-y: auto; z-index: 1000; width: 100%; margin-top: -0.5rem; margin-bottom: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></div>
                                    <div style="display: flex; gap: 0.5rem;">
                                        <input type="text" id="glsAddressZip" placeholder="Code postal" style="width: 35%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; font-family: inherit;">
                                        <input type="text" id="glsAddressCity" placeholder="Ville" style="width: 65%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; font-family: inherit;">
                                    </div>
                                </div>
                            </div>
                            <div class="delivery-option-price">10 - 15 €</div>
                        </div>

                        <div class="delivery-option" data-mode="pickup">
                            <div class="delivery-option-radio"></div>
                            <div class="delivery-option-content">
                                <h4>
                                    <i class="fas fa-store"></i>
                                    Retrait en boutique
                                </h4>
                                <p>Récupérez votre commande au 21 Rue Lafayette, 57000 Metz. <br>Lun-Ven : 10h-12h / 14h-19h | Sam : 9h30-19h</p>
                            </div>
                            <div class="delivery-option-price free">Gratuit</div>
                        </div>
                    </div>

                    <div class="delivery-address-section" id="localAddressSection">
                        <label style="font-size: 0.9rem; font-weight: 600; color: #5A5A5A; display: block; margin-bottom: 0.75rem;">
                            <i class="fas fa-map-marker-alt"></i> Adresse de livraison
                        </label>
                        <input type="text" id="deliveryAddressName" placeholder="Nom complet" style="width: 100%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; margin-bottom: 0.5rem; font-family: inherit;">
                        <div style="position: relative;">
                            <input type="text" id="deliveryAddressInput" placeholder="Adresse (numéro et rue)" autocomplete="off" style="width: 100%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; margin-bottom: 0.5rem; font-family: inherit;">
                            <div id="localAddressSuggestions" style="display: none; position: absolute; background: white; border: 1px solid #E0E0E0; border-top: none; border-radius: 0 0 8px 8px; max-height: 200px; overflow-y: auto; z-index: 1000; width: 100%; margin-top: -0.5rem; margin-bottom: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></div>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <input type="text" id="deliveryAddressZip" placeholder="Code postal" maxlength="5" pattern="[0-9]{5}" style="width: 35%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; font-family: inherit;">
                            <input type="text" id="deliveryAddressCity" placeholder="Ville" style="width: 65%; padding: 0.65rem; border: 2px solid #E0E0E0; border-radius: 8px; font-size: 0.95rem; font-family: inherit;">
                        </div>
                        <div class="address-loader" id="addressLoader"><i class="fas fa-spinner fa-spin"></i> Vérification de l'adresse...</div>
                        <div class="distance-result" id="distanceResult"></div>
                    </div>

                    <div class="delivery-date-section" style="display: none;">
                        <label><i class="fas fa-calendar-alt"></i> Date de livraison souhaitée</label>
                        <div class="custom-calendar-wrapper">
                            <div class="calendar-header">
                                <button type="button" id="prevMonthBtn" class="calendar-nav-btn">
                                    <i class="fas fa-chevron-left"></i>
                                </button>
                                <div class="calendar-month-year" id="calendarMonthYear">Février 2026</div>
                                <button type="button" id="nextMonthBtn" class="calendar-nav-btn">
                                    <i class="fas fa-chevron-right"></i>
                                </button>
                            </div>
                            <div class="calendar-weekdays">
                                <div class="calendar-weekday">Lun</div>
                                <div class="calendar-weekday">Mar</div>
                                <div class="calendar-weekday">Mer</div>
                                <div class="calendar-weekday">Jeu</div>
                                <div class="calendar-weekday">Ven</div>
                                <div class="calendar-weekday">Sam</div>
                                <div class="calendar-weekday">Dim</div>
                            </div>
                            <div class="calendar-days-grid" id="calendarDaysGrid">
                                </div>
                            <input type="hidden" id="deliveryDateInput">
                        </div>
                        <div class="date-hint" id="dateHint">
                            <i class="fas fa-info-circle"></i>
                            <span>Sélectionnez d'abord un mode de livraison</span>
                        </div>
                    </div>

                    <div class="delivery-summary" id="deliverySummary" style="display:none;">
                        <h4><i class="fas fa-receipt"></i> Récapitulatif</h4>
                        <div class="summary-row">
                            <span>Sous-total</span>
                            <span class="summary-value" id="summarySubtotal">0,00 €</span>
                        </div>
                        <div class="summary-row">
                            <span id="summaryDeliveryLabel">Livraison</span>
                            <span class="summary-value" id="summaryDeliveryPrice">—</span>
                        </div>
                        <div class="summary-row">
                            <span id="summaryDateLabel">Date souhaitée</span>
                            <span class="summary-value" id="summaryDate">—</span>
                        </div>
                        <div class="summary-row total">
                            <span>Total estimé</span>
                            <span class="summary-value" id="summaryTotal">0,00 €</span>
                        </div>
                    </div>

                    <div class="delivery-actions">
                        <button class="btn btn-secondary" id="deliveryBack">
                            <i class="fas fa-arrow-left"></i>
                            <span>Retour</span>
                        </button>
                        <button class="btn btn-primary" id="deliveryConfirm" disabled>
                            <span>Valider et payer</span>
                            <i class="fas fa-lock"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    },

    // ===================================
    // Bind Events
    // ===================================
    bindEvents() {
        const overlay = document.getElementById('deliveryOverlay');
        if (!overlay) return;

        // Close
        overlay.querySelector('.delivery-backdrop').addEventListener('click', () => this.close());
        overlay.querySelector('.delivery-close').addEventListener('click', () => this.close());
        overlay.querySelector('.delivery-mobile-back').addEventListener('click', () => this.close());

        // Delivery mode selection
        overlay.querySelectorAll('.delivery-option').forEach(option => {
            option.addEventListener('click', (e) => {
                // Don't trigger if clicking sub-options
                if (e.target.closest('.gls-suboptions')) return;
                this.selectMode(option.dataset.mode);
            });
        });

        // GLS sub-options
        overlay.querySelectorAll('.gls-suboption').forEach(sub => {
            sub.addEventListener('click', () => {
                overlay.querySelectorAll('.gls-suboption').forEach(s => s.classList.remove('selected'));
                sub.classList.add('selected');
                sub.querySelector('input').checked = true;
                this.selectedSubMode = sub.dataset.sub;
                this.updateGlsAddressVisibility();
                this.updatePricing();
            });
        });

        // Address input (debounced) - compose from separate fields
        let addressTimeout;
        const addressFields = ['deliveryAddressInput', 'deliveryAddressZip', 'deliveryAddressCity'];
        addressFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', () => {
                    clearTimeout(addressTimeout);
                    addressTimeout = setTimeout(() => {
                        const street = document.getElementById('deliveryAddressInput')?.value || '';
                        const zip = document.getElementById('deliveryAddressZip')?.value || '';
                        const city = document.getElementById('deliveryAddressCity')?.value || '';
                        const fullAddress = `${street}, ${zip} ${city}`.trim();
                        if (street.length >= 3 && zip.length >= 4 && city.length >= 2) {
                            this.calculateDistance(fullAddress);
                        }
                    }, 800);
                });
            }
        });

        // GLS address street input with autocomplete
        const glsAddressStreet = document.getElementById('glsAddressStreet');
        if (glsAddressStreet) {
            glsAddressStreet.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.searchAddressAPI(query, 'glsAddressSuggestions');
            });
            
            // Hide suggestions when clicking outside
            glsAddressStreet.addEventListener('blur', () => {
                setTimeout(() => {
                    const suggestionsDiv = document.getElementById('glsAddressSuggestions');
                    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
                }, 150);
            });
        }

        // GLS zip & city: validate France in real time
        ['glsAddressZip', 'glsAddressCity', 'deliveryAddressZip'].forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', () => this.updateSummary());
            }
        });

        // LOCAL address street input with autocomplete
        const localAddressInput = document.getElementById('deliveryAddressInput');
        if (localAddressInput) {
            localAddressInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.searchAddressAPI(query, 'localAddressSuggestions');
            });
            
            // Hide suggestions when clicking outside
            localAddressInput.addEventListener('blur', () => {
                setTimeout(() => {
                    const suggestionsDiv = document.getElementById('localAddressSuggestions');
                    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
                }, 150);
            });
        }

        // Calendar navigation buttons
        const prevMonthBtn = document.getElementById('prevMonthBtn');
        const nextMonthBtn = document.getElementById('nextMonthBtn');
        if (prevMonthBtn) {
            prevMonthBtn.addEventListener('click', () => {
                this.currentCalendarMonth--;
                if (this.currentCalendarMonth < 0) {
                    this.currentCalendarMonth = 11;
                    this.currentCalendarYear--;
                }
                this.renderCalendar();
            });
        }
        if (nextMonthBtn) {
            nextMonthBtn.addEventListener('click', () => {
                this.currentCalendarMonth++;
                if (this.currentCalendarMonth > 11) {
                    this.currentCalendarMonth = 0;
                    this.currentCalendarYear++;
                }
                this.renderCalendar();
            });
        }

        // Back button
        document.getElementById('deliveryBack').addEventListener('click', () => this.close());

        // Confirm button
        document.getElementById('deliveryConfirm').addEventListener('click', () => this.confirm());
    },

    updateGlsAddressVisibility() {
        const glsAddressSection = document.getElementById('glsAddressSection');
        const relaisInfoMessage = document.getElementById('relaisInfoMessage');
        if (!glsAddressSection) return;

        // Show address fields ONLY for domicile mode (not for point relais)
        // Point relais: user will select the relay point after payment, no address needed
        const requiresAddress = this.selectedMode === 'france' && this.selectedSubMode === 'domicile';
        glsAddressSection.style.display = requiresAddress ? 'block' : 'none';
        
        // Show relais info message when relais is selected
        if (relaisInfoMessage) {
            const showRelaisMessage = this.selectedMode === 'france' && this.selectedSubMode === 'relais';
            relaisInfoMessage.style.display = showRelaisMessage ? 'block' : 'none';
        }
    },

    // ===================================
    // Open Delivery Panel
    // ===================================
    open(cartSubtotal) {
        this.cartSubtotal = cartSubtotal || 0;
        
        // Reload unavailable dates before showing panel
        this.loadUnavailableDates();
        
        this.reset();
        
        // Pre-fill with logged-in user's account information
        this.prefillFromUserAccount();
        
        const overlay = document.getElementById('deliveryOverlay');
        if (overlay) {
            overlay.classList.add('active');
            if (window.innerWidth > 768) {
                document.body.style.overflow = 'hidden';
            } else {
                // Mobile : masquer la scrollbar du body sans bloquer le scroll du panel
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
            }
        }
    },

    // Pre-fill delivery panel with logged-in user's stored address
    prefillFromUserAccount() {
        try {
            const userStr = localStorage.getItem('fleuriste_user');
            if (!userStr) return;
            
            const user = JSON.parse(userStr);
            if (!user) return;
            
            // Try to get addresses from dashboard storage
            let addressToUse = null;
            const addressesStr = localStorage.getItem('fleuriste_addresses_' + user.id);
            if (addressesStr) {
                const addresses = JSON.parse(addressesStr);
                if (addresses && addresses.length > 0) {
                    // Get the default address, or the first one
                    addressToUse = addresses.find(a => a.isDefault) || addresses[0];
                }
            }
            
            // Fallback to user.defaultAddress from Shopify if available
            if (!addressToUse && user.defaultAddress) {
                addressToUse = user.defaultAddress;
            }
            
            if (!addressToUse) return;
            
            const addr = addressToUse;
            const overlay = document.getElementById('deliveryOverlay');
            if (!overlay) return;
            
            // Pre-fill name
            const nameField = document.getElementById('glsAddressName');
            if (nameField && (addr.firstName || user.firstName) && (addr.lastName || user.lastName)) {
                nameField.value = `${addr.firstName || user.firstName} ${addr.lastName || user.lastName}`;
            }
            
            // Pre-fill address - handle both address1 and street properties
            const streetField = document.getElementById('glsAddressStreet');
            if (streetField && (addr.address1 || addr.street)) {
                streetField.value = addr.address1 || addr.street;
            }
            
            // Pre-fill zip - handle both zip and postalCode properties
            const zipField = document.getElementById('glsAddressZip');
            if (zipField && (addr.zip || addr.postalCode)) {
                zipField.value = addr.zip || addr.postalCode;
            }
            
            // Pre-fill city
            const cityField = document.getElementById('glsAddressCity');
            if (cityField && addr.city) {
                cityField.value = addr.city;
            }
            
            // Pre-select GLS Domicile mode if address exists
            const streetVal = addr.address1 || addr.street;
            const zipVal = addr.zip || addr.postalCode;
            if (streetVal && zipVal && addr.city) {
                const glsDomicileOption = overlay.querySelector('[data-mode="france"]');
                if (glsDomicileOption) {
                    glsDomicileOption.classList.add('selected');
                    overlay.querySelectorAll('[data-mode]').forEach(o => {
                        if (o !== glsDomicileOption) o.classList.remove('selected');
                    });
                    
                    // Set the domicile sub-option as selected
                    const domicileSuboption = overlay.querySelector('.gls-suboption[data-sub="domicile"]');
                    if (domicileSuboption) {
                        overlay.querySelectorAll('.gls-suboption').forEach(s => s.classList.remove('selected'));
                        domicileSuboption.classList.add('selected');
                        domicileSuboption.querySelector('input').checked = true;
                    }
                    
                    this.selectMode('france');
                    this.selectedSubMode = 'domicile';
                    this.updateGlsAddressVisibility();
                    this.updatePricing();
                }
            }
        } catch (e) {
            console.warn('Could not prefill from user account:', e);
        }
    },

    // ===================================
    // Address Autocomplete Search
    // ===================================
    async searchAddressAPI(query, suggestionsDivId = 'glsAddressSuggestions') {
        const suggestionsDiv = document.getElementById(suggestionsDivId);
        
        if (!query || query.length < 3) {
            if (suggestionsDiv) suggestionsDiv.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(
                `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=8`
            );
            const data = await response.json();
            
            if (!suggestionsDiv) return;
            
            if (data.features && data.features.length > 0) {
                suggestionsDiv.innerHTML = data.features.map((feature, index) => {
                    const props = feature.properties;
                    const address = `${props.name || ''} ${props.postcode || ''} ${props.city || ''}`;
                    return `
                        <div style="padding: 0.75rem; border-bottom: 1px solid #F0F0F0; cursor: pointer; font-size: 0.9rem; color: #333;" 
                             data-index="${index}" 
                             data-street="${props.name || ''}" 
                             data-zip="${props.postcode || ''}" 
                             data-city="${props.city || ''}"
                             data-target="${suggestionsDivId === 'localAddressSuggestions' ? 'local' : 'gls'}"
                             onmouseover="this.style.backgroundColor='#F5F5F5'"
                             onmouseout="this.style.backgroundColor='transparent'">
                            <strong>${props.name || ''}</strong><br>
                            <small style="color: #888;">${props.postcode || ''} ${props.city || ''}</small>
                        </div>
                    `;
                }).join('');
                
                suggestionsDiv.style.display = 'block';
                
                // Add click listeners to suggestions
                suggestionsDiv.querySelectorAll('div[data-index]').forEach(item => {
                    item.addEventListener('mousedown', (e) => {
                        e.preventDefault(); // Prevent blur from hiding before click
                        this.selectAddressFromSuggestion(
                            item.dataset.street,
                            item.dataset.zip,
                            item.dataset.city,
                            item.dataset.target
                        );
                    });
                });
            } else {
                suggestionsDiv.style.display = 'none';
            }
        } catch (error) {
            console.warn('Address search error:', error);
            if (suggestionsDiv) suggestionsDiv.style.display = 'none';
        }
    },

    selectAddressFromSuggestion(street, zip, city, target = 'gls') {
        let streetField, zipField, cityField, suggestionsDiv;
        
        if (target === 'local') {
            // Local delivery fields
            streetField = document.getElementById('deliveryAddressInput');
            zipField = document.getElementById('deliveryAddressZip');
            cityField = document.getElementById('deliveryAddressCity');
            suggestionsDiv = document.getElementById('localAddressSuggestions');
        } else {
            // GLS fields
            streetField = document.getElementById('glsAddressStreet');
            zipField = document.getElementById('glsAddressZip');
            cityField = document.getElementById('glsAddressCity');
            suggestionsDiv = document.getElementById('glsAddressSuggestions');
        }
        
        if (streetField) streetField.value = street;
        if (zipField) zipField.value = zip;
        if (cityField) cityField.value = city;
        if (suggestionsDiv) suggestionsDiv.style.display = 'none';
        
        // Trigger validation/distance calculation
        this.deliveryAddress = `${street}, ${zip} ${city}`;
        if (this.selectedMode === 'local' || target === 'local') {
            this.calculateDistance(this.deliveryAddress);
        }
    },

    // ===================================
    // Close Delivery Panel
    // ===================================
    close() {
        const overlay = document.getElementById('deliveryOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            if (window.innerWidth > 768) {
                document.body.style.overflow = '';
            } else {
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            }
        }
    },

    // ===================================
    // Reset State
    // ===================================
    reset() {
        this.selectedMode = null;
        this.selectedSubMode = 'domicile';
        this.deliveryAddress = '';
        this.deliveryDistance = null;
        this.deliveryPrice = null;
        this.selectedDate = null;
        
        // Reset calendar to current month
        this.currentCalendarMonth = new Date().getMonth();
        this.currentCalendarYear = new Date().getFullYear();

        const overlay = document.getElementById('deliveryOverlay');
        if (!overlay) return;

        overlay.querySelectorAll('.delivery-option').forEach(o => o.classList.remove('selected'));
        document.getElementById('localAddressSection').classList.remove('visible');
        document.getElementById('glsSuboptions').classList.remove('visible');
        const glsAddr = document.getElementById('glsAddressSection');
        if (glsAddr) glsAddr.style.display = 'none';
        document.getElementById('distanceResult').classList.remove('visible', 'success', 'warning', 'error');
        document.getElementById('deliverySummary').style.display = 'none';
        document.getElementById('deliveryConfirm').disabled = true;
        document.getElementById('deliveryDateInput').value = '';
        document.getElementById('deliveryAddressInput').value = '';
        const addrName = document.getElementById('deliveryAddressName');
        const addrZip = document.getElementById('deliveryAddressZip');
        const addrCity = document.getElementById('deliveryAddressCity');
        if (addrName) addrName.value = '';
        if (addrZip) addrZip.value = '';
        if (addrCity) addrCity.value = '';
        
        // Masquer complètement la zone de date au reset
        const dateSection = document.querySelector('.delivery-date-section');
        if (dateSection) dateSection.style.display = 'none';
        document.getElementById('dateHint').innerHTML = '<i class="fas fa-info-circle"></i><span>Sélectionnez d\'abord un mode de livraison</span>';
        
        // Reset date summary row visibility
        const dateRow = document.getElementById('summaryDate')?.closest('.summary-row');
        if (dateRow) dateRow.style.display = '';

        // Reset step indicators
        overlay.querySelectorAll('.delivery-step-indicator').forEach(s => {
            s.classList.remove('active', 'completed');
        });
        overlay.querySelector('[data-step="1"]').classList.add('active');
        overlay.querySelectorAll('.step-connector').forEach(c => c.classList.remove('completed'));

        // Reset GLS sub-options
        overlay.querySelectorAll('.gls-suboption').forEach(s => s.classList.remove('selected'));
        overlay.querySelector('.gls-suboption[data-sub="domicile"]').classList.add('selected');
        overlay.querySelector('input[value="domicile"]').checked = true;
    },

    // ===================================
    // Select Delivery Mode
    // ===================================
    selectMode(mode) {
        this.selectedMode = mode;

        const overlay = document.getElementById('deliveryOverlay');
        overlay.querySelectorAll('.delivery-option').forEach(o => o.classList.remove('selected'));
        overlay.querySelector(`[data-mode="${mode}"]`).classList.add('selected');

        // Show/hide relevant sections
        const localSection = document.getElementById('localAddressSection');
        const glsSuboptions = document.getElementById('glsSuboptions');
        const dateInput = document.getElementById('deliveryDateInput');
        const dateHint = document.getElementById('dateHint');

        localSection.classList.remove('visible');
        glsSuboptions.classList.remove('visible');
        const glsAddressSection = document.getElementById('glsAddressSection');
        const relaisInfoMessage = document.getElementById('relaisInfoMessage');
        if (glsAddressSection) glsAddressSection.style.display = 'none';
        if (relaisInfoMessage) relaisInfoMessage.style.display = 'none';

        // Show/hide date section based on mode
        const dateSection = document.querySelector('.delivery-date-section');

        if (mode === 'local') {
            localSection.classList.add('visible');
            const today = new Date().toISOString().split('T')[0];
            dateInput.min = today;
            
            // Show hint with unavailable dates if any
            let hintText = 'Livraison possible le jour même selon disponibilité*';
            if (this.unavailableDates.length > 0) {
                const sortedDates = [...this.unavailableDates].sort();
                const formattedDates = sortedDates.map(dateStr => {
                    const date = new Date(dateStr + 'T12:00:00');
                    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                }).join(', ');
                hintText += `<br><span style="color:#dc2626;">⚠️ Dates indisponibles: ${formattedDates}</span>`;
            }
            dateHint.innerHTML = `<i class="fas fa-info-circle"></i><span>${hintText}</span>`;
            if (dateSection) dateSection.style.display = 'block';
            // Render calendar
            this.renderCalendar();
        } else if (mode === 'france') {
            glsSuboptions.classList.add('visible');
            this.selectedSubMode = overlay.querySelector('.gls-suboption.selected')?.dataset.sub || 'domicile';
            this.updateGlsAddressVisibility();
            // Hide date picker for GLS — no date selection
            if (dateSection) dateSection.style.display = 'none';
            this.selectedDate = null;
            dateInput.value = '';
        } else if (mode === 'pickup') {
            const today = new Date().toISOString().split('T')[0];
            dateInput.min = today;
            // Ajout affichage dates indisponibles retrait
            let hintText = "Retrait possible le jour même aux horaires d'ouverture*";
            if (this.unavailablePickupDates.length > 0) {
                const sortedDates = [...this.unavailablePickupDates].sort();
                const formattedDates = sortedDates.map(dateStr => {
                    const date = new Date(dateStr + 'T12:00:00');
                    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                }).join(', ');
                hintText += `<br><span style="color:#dc2626;">⚠️ Dates indisponibles: ${formattedDates}</span>`;
            }
            dateHint.innerHTML = `<i class="fas fa-info-circle"></i><span>${hintText}</span>`;
            if (dateSection) dateSection.style.display = 'block';
            // Render calendar
            this.renderCalendar();
        }

        // Update step indicators
        overlay.querySelector('[data-step="1"]').classList.add('completed');
        overlay.querySelector('[data-step="1"]').classList.remove('active');
        overlay.querySelector('[data-step="2"]').classList.add('active');
        overlay.querySelectorAll('.step-connector')[0].classList.add('completed');

        this.updatePricing();
    },

    // ===================================
    // Calculate Distance (using geocoding approximation)
    // ===================================
    async calculateDistance(address) {
        if (!address || address.length < 5) {
            document.getElementById('distanceResult').classList.remove('visible');
            this.deliveryDistance = null;
            this.updatePricing();
            return;
        }

        const loader = document.getElementById('addressLoader');
        const result = document.getElementById('distanceResult');
        if (loader) loader.classList.add('active');
        result.classList.remove('visible', 'success', 'warning', 'error');

        try {
            // Use Nominatim (OpenStreetMap) for free geocoding
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=fr,be,lu&limit=1`,
                { headers: { 'Accept-Language': 'fr' } }
            );
            const data = await response.json();

            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                
                // Calculate distance (Haversine formula * 1.3 for road approximation)
                const distance = this.haversineDistance(this.config.shopLat, this.config.shopLng, lat, lng);
                const roadDistance = Math.round(distance * 1.3); // approximate road distance
                
                this.deliveryDistance = roadDistance;
                this.deliveryAddress = address;

                if (roadDistance <= this.config.maxLocalDistance) {
                    let priceInfo = this.getLocalPrice(roadDistance);
                    result.className = 'distance-result visible success';
                    result.innerHTML = `<i class="fas fa-check-circle"></i> ~${roadDistance} km — Frais de livraison : <strong>${priceInfo.label}</strong>`;
                } else {
                    result.className = 'distance-result visible error';
                    result.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ~${roadDistance} km — Adresse trop éloignée pour la livraison locale. Choisissez la livraison France (GLS).`;
                    this.deliveryDistance = null;
                }
            } else {
                result.className = 'distance-result visible warning';
                result.innerHTML = `<i class="fas fa-exclamation-circle"></i> Adresse non trouvée. Vérifiez l'adresse et réessayez.`;
                this.deliveryDistance = null;
            }
        } catch (error) {
            console.error('Distance calculation error:', error);
            // Fallback: let user proceed without distance check
            result.className = 'distance-result visible warning';
            result.innerHTML = `<i class="fas fa-info-circle"></i> Impossible de vérifier la distance. Les frais seront confirmés par My Flowers.`;
            this.deliveryDistance = 15; // assume mid-range
        }

        if (loader) loader.classList.remove('active');
        this.updatePricing();
    },

    // ===================================
    // Haversine Distance (km)
    // ===================================
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    // ===================================
    // Get Local Delivery Price
    // ===================================
    getLocalPrice(distanceKm) {
        for (const tier of this.config.localPricing) {
            if (distanceKm <= tier.maxKm) {
                return { price: tier.price, label: tier.label };
            }
        }
        return { price: null, label: 'Non disponible' };
    },

    // ===================================
    // Update Pricing
    // ===================================
    updatePricing() {
        if (!this.selectedMode) {
            this.deliveryPrice = null;
            this.updateSummary();
            return;
        }

        switch (this.selectedMode) {
            case 'local':
                if (this.deliveryDistance !== null) {
                    const priceInfo = this.getLocalPrice(this.deliveryDistance);
                    this.deliveryPrice = priceInfo.price;
                } else {
                    this.deliveryPrice = null;
                }
                break;
                
            case 'france':
                if (this.selectedSubMode === 'relais') {
                    this.deliveryPrice = this.config.francePricing.relais.price;
                } else {
                    this.deliveryPrice = this.config.francePricing.domicile.price;
                }
                break;
                
            case 'pickup':
                this.deliveryPrice = this.config.pickupPrice;
                break;
        }

        this.updateSummary();
    },

    // ===================================
    // Validate Date
    // ===================================
    validateDate() {
        const dateInput = document.getElementById('deliveryDateInput');
        const selectedDate = new Date(this.selectedDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if Sunday
        if (selectedDate.getDay() === 0) {
            this.showDateError('⛔ La boutique est fermée le dimanche. Veuillez choisir un autre jour.');
            this.selectedDate = null;
            dateInput.value = '';
            this.renderCalendar();
            return false;
        }

        // Check if date is unavailable (only for local delivery)
        if (this.selectedMode === 'local') {
            const dateStr = this.selectedDate;
            if (!this.isDateAvailable(dateStr)) {
                const date = new Date(dateStr + 'T12:00:00');
                const formatted = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                this.showDateError(`⛔ Le ${formatted} n'est pas disponible pour la livraison. Veuillez en choisir une autre.`);
                this.selectedDate = null;
                dateInput.value = '';
                this.renderCalendar();
                return false;
            }
        }

        return true;
    },

    showDateError(message) {
        const dateHint = document.getElementById('dateHint');
        dateHint.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><span style="color:#dc2626;">${message}</span>`;
        setTimeout(() => {
            this.selectMode(this.selectedMode); // re-set the normal hint
        }, 3000);
    },

    // ===================================
    // Update Summary
    // ===================================
    updateSummary() {
        const summary = document.getElementById('deliverySummary');
        const confirmBtn = document.getElementById('deliveryConfirm');
        const overlay = document.getElementById('deliveryOverlay');

        const hasMode = this.selectedMode !== null;
        const hasPrice = this.deliveryPrice !== null;
        const hasDate = this.selectedDate !== null;
        const glsAddressRequired = this.selectedMode === 'france' && this.selectedSubMode !== 'relais';
        const glsAddressProvided = !glsAddressRequired || (
            (document.getElementById('glsAddressStreet')?.value || '').trim().length >= 3 &&
            (document.getElementById('glsAddressZip')?.value || '').trim().length >= 4 &&
            (document.getElementById('glsAddressCity')?.value || '').trim().length >= 2 &&
            this.validateFrenchAddress()
        );
        const hasAddress = this.selectedMode === 'local'
            ? (this.deliveryDistance !== null && this.validateFrenchAddress())
            : glsAddressProvided;
        // For France GLS, date is not required
        const dateOk = this.selectedMode === 'france' || hasDate;

        const canConfirm = hasMode && hasPrice && dateOk && hasAddress;
        
        if (hasMode && (hasPrice || this.selectedMode === 'pickup')) {
            summary.style.display = 'block';

            // Subtotal
            const subtotalDisplay = this.formatPrice(this.cartSubtotal);
            document.getElementById('summarySubtotal').textContent = subtotalDisplay;

            // Delivery label & price
            const labelMap = {
                'local': 'Livraison locale My Flowers',
                'france': this.selectedSubMode === 'relais' ? 'Livraison GLS (point relais)' : 'Livraison GLS (domicile)',
                'pickup': 'Retrait en boutique'
            };
            document.getElementById('summaryDeliveryLabel').textContent = labelMap[this.selectedMode] || 'Livraison';
            
            const priceEl = document.getElementById('summaryDeliveryPrice');
            if (this.deliveryPrice === 0) {
                priceEl.textContent = 'Gratuit';
                priceEl.classList.add('free');
            } else if (this.deliveryPrice !== null) {
                const priceDisplay = this.formatPrice(this.deliveryPrice);
                priceEl.textContent = priceDisplay;
                priceEl.classList.remove('free');
            } else {
                priceEl.textContent = '—';
                priceEl.classList.remove('free');
            }

            // Date
            const dateEl = document.getElementById('summaryDate');
            const dateRow = dateEl?.closest('.summary-row');
            if (this.selectedMode === 'france') {
                // Hide date row for GLS
                if (dateRow) dateRow.style.display = 'none';
            } else if (this.selectedDate) {
                if (dateRow) dateRow.style.display = '';
                const d = new Date(this.selectedDate);
                dateEl.textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            } else {
                if (dateRow) dateRow.style.display = '';
                dateEl.textContent = '—';
            }

            // Total
            const total = this.cartSubtotal + (this.deliveryPrice || 0);
            const totalDisplay = this.formatPrice(total);
            document.getElementById('summaryTotal').textContent = totalDisplay;

            // Step indicators
            if (dateOk) {
                overlay.querySelector('[data-step="2"]').classList.add('completed');
                overlay.querySelector('[data-step="2"]').classList.remove('active');
                overlay.querySelector('[data-step="3"]').classList.add('active');
                overlay.querySelectorAll('.step-connector')[1].classList.add('completed');
            }
        } else {
            summary.style.display = 'none';
        }

        confirmBtn.disabled = !canConfirm;
    },

    // ===================================
    // Validate French Address
    // ===================================
    validateFrenchAddress() {
        // Determine which zip field to check based on mode
        let zipFieldId, errorAnchorId;
        if (this.selectedMode === 'france' && this.selectedSubMode === 'domicile') {
            zipFieldId = 'glsAddressZip';
            errorAnchorId = 'glsAddressZip';
        } else if (this.selectedMode === 'local') {
            zipFieldId = 'deliveryAddressZip';
            errorAnchorId = 'deliveryAddressZip';
        } else {
            return true; // relais or pickup: no address needed
        }

        const zip = (document.getElementById(zipFieldId)?.value || '').trim();
        if (!zip) return false; // No zip entered yet

        // French postal codes: 5 digits, starting 01-95 for metropolitan,
        // or 971-976 for DOM-TOM (Guadeloupe, Martinique, Guyane, Réunion, Mayotte)
        const frenchZipRegex = /^(0[1-9]|[1-8]\d|9[0-5])\d{3}$|^97[1-6]\d{2}$|^98[4-9]\d{2}$/;
        const isValid = frenchZipRegex.test(zip);

        // Show/hide error message on the zip field
        const zipField = document.getElementById(zipFieldId);
        const errorMsgId = zipFieldId + 'ErrorMsg';
        const existingError = document.getElementById(errorMsgId);

        if (!isValid && zip.length >= 4) {
            zipField.style.borderColor = '#dc2626';
            if (!existingError) {
                const msg = document.createElement('div');
                msg.id = errorMsgId;
                msg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Livraison disponible en France uniquement. Vérifiez le code postal.';
                msg.style.cssText = 'color:#dc2626; font-size:0.82rem; margin-top:0.5rem; font-weight:500; clear:both;';
                // Insert after the parent row (the flex div containing zip + city)
                const parentRow = zipField.parentNode;
                parentRow.parentNode.insertBefore(msg, parentRow.nextSibling);
            }
        } else {
            zipField.style.borderColor = '';
            if (existingError) existingError.remove();
        }

        return isValid;
    },

    // ===================================
    // Format Price
    // ===================================
    formatPrice(amount) {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    },

    // ===================================
    // Confirm & Proceed to Checkout
    // ===================================
    async confirm() {
        if (!this.selectedMode || this.deliveryPrice === null || (this.selectedMode !== 'france' && !this.selectedDate)) return;

        // Store delivery info for checkout
        const deliveryInfo = {
            mode: this.selectedMode,
            subMode: this.selectedSubMode,
            address: this.deliveryAddress,
            distance: this.deliveryDistance,
            price: this.deliveryPrice,
            date: this.selectedDate || null,
            dateFormatted: this.selectedDate
                ? new Date(this.selectedDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                : null
        };

        // Structured address for checkout prefill
        if (this.selectedMode === 'france') {
            // For point relais, we only need the name (address will be the relay point)
            if (this.selectedSubMode === 'relais') {
                // Get user name from logged-in account or leave empty
                const userStr = localStorage.getItem('fleuriste_user');
                if (userStr) {
                    try {
                        const user = JSON.parse(userStr);
                        deliveryInfo.fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
                    } catch (e) {}
                }
                // No address needed - will be selected after payment
                deliveryInfo.street = '';
                deliveryInfo.zip = '';
                deliveryInfo.city = '';
                deliveryInfo.country = 'France';
            } else {
                // Domicile mode - full address required
                deliveryInfo.fullName = (document.getElementById('glsAddressName')?.value || '').trim();
                deliveryInfo.street = (document.getElementById('glsAddressStreet')?.value || '').trim();
                deliveryInfo.zip = (document.getElementById('glsAddressZip')?.value || '').trim();
                deliveryInfo.city = (document.getElementById('glsAddressCity')?.value || '').trim();
                deliveryInfo.country = 'France';
            }
        } else if (this.selectedMode === 'local') {
            deliveryInfo.fullName = (document.getElementById('deliveryAddressName')?.value || '').trim();
            deliveryInfo.street = (document.getElementById('deliveryAddressInput')?.value || '').trim();
            deliveryInfo.zip = (document.getElementById('deliveryAddressZip')?.value || '').trim();
            deliveryInfo.city = (document.getElementById('deliveryAddressCity')?.value || '').trim();
            deliveryInfo.country = 'France';
        }

        localStorage.setItem('myflowers_delivery', JSON.stringify(deliveryInfo));

        // Build note for Shopify checkout
        const modeLabels = {
            'local': 'Livraison locale My Flowers',
            'france': this.selectedSubMode === 'relais' ? 'GLS Point Relais' : 'GLS Domicile',
            'pickup': 'Retrait en boutique'
        };

        const note = `Mode: ${modeLabels[this.selectedMode]}` +
            (deliveryInfo.dateFormatted ? ` | Date souhaitée: ${deliveryInfo.dateFormatted}` : '') +
            (this.deliveryAddress ? ` | Adresse: ${this.deliveryAddress}` : '') +
            ` | Frais livraison: ${this.deliveryPrice === 0 ? 'Gratuit' : this.formatPrice(this.deliveryPrice)}`;

        // Try to add note to Shopify cart via attributes
        await this.addCartNote(note);

        // Proceed to Shopify checkout
        this.close();
        
        // Show loading overlay during checkout preparation
        this.showCheckoutLoader();
        
        if (typeof ShopifyIntegration !== 'undefined' && ShopifyIntegration.cart && ShopifyIntegration.cart.checkoutUrl) {
            try {
                const checkoutUrl = await ShopifyIntegration.getCheckoutUrlWithCustomOptions(note, deliveryInfo);
                
                if (checkoutUrl) {
                    // Small delay to ensure the checkout is ready
                    await new Promise(resolve => setTimeout(resolve, 300));
                    const finalCheckoutUrl = this.normalizeCheckoutUrl(checkoutUrl);
                    console.log('FINAL CHECKOUT URL delivery =', finalCheckoutUrl);
                    alert(finalCheckoutUrl);
                    window.location.href = finalCheckoutUrl;
                } else {
                    this.hideCheckoutLoader();
                    const finalCartUrl = this.normalizeCheckoutUrl(ShopifyIntegration.cart.checkoutUrl);
                    console.log('FINAL CART URL delivery =', finalCartUrl);
                    alert(finalCartUrl);
                    window.location.href = finalCartUrl;
                }
            } catch (error) {
                console.error('Checkout error:', error);
                this.hideCheckoutLoader();
                this.showNotification('Erreur lors de la préparation du paiement. Veuillez réessayer.', 'error');
            }
        } else {
            this.hideCheckoutLoader();
            // Demo mode notification
            this.showNotification('Commande confirmée ! En production, vous seriez redirigé vers le paiement sécurisé.', 'success');
        }
    },

    // ===================================
    // Show/Hide Checkout Loader
    // ===================================
    showCheckoutLoader() {
        // Remove existing loader if any
        this.hideCheckoutLoader();
        
        const loader = document.createElement('div');
        loader.id = 'checkout-loader-overlay';
        loader.innerHTML = `
            <div class="checkout-loader-content">
                <div class="checkout-loader-icon">
                    <i class="fas fa-flower-tulip"></i>
                </div>
                <div class="checkout-spinner"></div>
                <h3>Préparation de votre paiement...</h3>
                <p>Vous allez être redirigé vers la page de paiement sécurisé</p>
            </div>
        `;
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            backdrop-filter: blur(8px);
        `;
        
        const content = loader.querySelector('.checkout-loader-content');
        content.style.cssText = `
            text-align: center;
            padding: 50px 40px;
            border-radius: 20px;
            max-width: 400px;
        `;

        const icon = loader.querySelector('.checkout-loader-icon');
        icon.style.cssText = `
            font-size: 2.5rem;
            color: #D4A574;
            margin-bottom: 20px;
        `;
        
        const spinner = loader.querySelector('.checkout-spinner');
        spinner.style.cssText = `
            width: 48px;
            height: 48px;
            border: 3px solid #f0e6db;
            border-top-color: #D4A574;
            border-radius: 50%;
            margin: 0 auto 24px;
            animation: checkout-spin 0.8s linear infinite;
        `;

        const h3 = loader.querySelector('h3');
        h3.style.cssText = `
            font-family: 'Playfair Display', serif;
            font-size: 1.3rem;
            color: #2c2c2c;
            margin: 0 0 8px 0;
            font-weight: 600;
        `;

        const p = loader.querySelector('p');
        p.style.cssText = `
            font-size: 0.95rem;
            color: #888;
            margin: 0;
        `;
        
        // Add keyframes for spinner animation
        if (!document.getElementById('checkout-loader-styles')) {
            const style = document.createElement('style');
            style.id = 'checkout-loader-styles';
            style.textContent = `
                @keyframes checkout-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(loader);
    },
    
    hideCheckoutLoader() {
        const loader = document.getElementById('checkout-loader-overlay');
        if (loader) {
            loader.remove();
        }
    },

    // ===================================
    // Add note to Shopify cart
    // ===================================
    async addCartNote(note) {
        if (typeof ShopifyIntegration === 'undefined' || !ShopifyIntegration.cart) return;

        try {
            const mutation = `
                mutation($cartId: ID!, $note: String) {
                    cartNoteUpdate(cartId: $cartId, note: $note) {
                        cart { id }
                    }
                }
            `;
            await ShopifyIntegration.graphqlRequest(mutation, {
                cartId: ShopifyIntegration.cart.id,
                note: note
            });
        } catch (error) {
            console.log('Note update skipped:', error.message);
        }
    },

    // ===================================
    // Show Notification
    // ===================================
    showNotification(message, type = 'info') {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const notif = document.createElement('div');
        notif.className = `notification notification-${type} show`;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        notif.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
        document.body.appendChild(notif);

        setTimeout(() => {
            notif.classList.remove('show');
            setTimeout(() => notif.remove(), 300);
        }, 5000);
    }
};

// ===================================
// Initialize on DOM ready
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    DeliverySystem.init();
});

// Export
window.DeliverySystem = DeliverySystem;
