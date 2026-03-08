// ===================================
// Configuration Shopify
// ===================================
const SHOPIFY_CONFIG = {
    storeDomain: 'myflowers-secours.myshopify.com',
    storefrontAccessToken: 'f04036dacc2874f796274bcc8ed64559',
    apiVersion: '2024-01'
};

// ===================================
// Shopify Integration Complète
// ===================================
const ShopifyIntegration = {
    products: [],
    cart: null,
    cartItems: [],
    currentPage: 1,
    productsPerPage: 12,
    currentFilter: 'all',
    currentSort: 'default',
    searchQuery: '',
    normalizeCheckoutUrl(checkoutUrl) {
        if (!checkoutUrl || typeof checkoutUrl !== 'string') return checkoutUrl;

        const trimmed = checkoutUrl.trim();
        if (!trimmed) return trimmed;

        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        if (trimmed.startsWith('//')) {
            return `https:${trimmed}`;
        }

        if (trimmed.startsWith('/')) {
            return `https://${SHOPIFY_CONFIG.storeDomain}${trimmed}`;
        }

        return `https://${SHOPIFY_CONFIG.storeDomain}/${trimmed.replace(/^\/+/, '')}`;
    },
    
    
    /**
     * Initialize
     */
    async init() {
        await this.fetchProducts();
        await this.createCart();
        this.initCartUI();
        this.loadCartFromStorage();
    },
    
    /**
     * Initialize for Homepage
     */
    async loadFeaturedProducts() {
        try {
            await this.init();
            await this.fetchCollections();
        } catch (error) {
            console.error('❌ Erreur chargement homepage:', error);
            this.products = this.products || [];
        }
        this.displayHomepageCollections();
        this.displayFeaturedProducts();
    },
    
    /**
     * Display Shopify collections on the homepage
     */
    displayHomepageCollections() {
        const grid = document.getElementById('homepageCollections');
        if (!grid || this.collections.length === 0) return;
        
        // Filter to only featured collections if config is available
        let displayCollections = this.collections;
        if (this.featuredCollections && this.featuredCollections.length > 0) {
            displayCollections = this.collections.filter(c => {
                const numericId = c.id.split('/').pop();
                return this.featuredCollections.includes(numericId);
            });
        }
        
        if (displayCollections.length === 0) {
            // Fallback: show all if no featured configured
            displayCollections = this.collections;
        }
        
        // Icon mapping fallback
        const iconMap = {
            'bouquet': 'fa-spa', 'rose': 'fa-gem', 'éternelle': 'fa-gem', 'eternelle': 'fa-gem',
            'kinder': 'fa-gift', 'box': 'fa-gift', 'coffret': 'fa-gift',
            'peluche': 'fa-heart', 'teddy': 'fa-heart',
            'accessoire': 'fa-ring', 'plante': 'fa-leaf',
            'composition': 'fa-seedling', 'mariage': 'fa-rings-wedding',
        };
        
        const self = this;
        function getIcon(collection) {
            // First check saved icons
            const numericId = collection.id.split('/').pop();
            if (self.collectionIcons && self.collectionIcons[numericId]) {
                return self.collectionIcons[numericId];
            }
            // Fallback to keyword detection
            const lower = collection.title.toLowerCase();
            for (const [kw, icon] of Object.entries(iconMap)) {
                if (lower.includes(kw)) return icon;
            }
            return 'fa-tag';
        }
        
        grid.innerHTML = displayCollections.map((collection, index) => {
            const icon = getIcon(collection);
            const image = collection.image?.url || '';
            const description = collection.description || '';
            const truncatedDesc = description.length > 80 ? description.substring(0, 80) + '...' : description;
            const productCount = collection.products.edges.length;
            
            // Use first product image as fallback if collection has no image
            let displayImage = image;
            if (!displayImage && collection.products.edges.length > 0) {
                // We'd need product images, so use a placeholder
                displayImage = '';
            }
            
            return `
                <a href="boutique.html?filter=collection:${collection.handle}" class="category-card" data-aos="fade-up" data-aos-delay="${(index + 1) * 100}">
                    <div class="category-image">
                        ${displayImage ? 
                            `<img src="${displayImage}" alt="${collection.title}">` :
                            `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f9f5f0 0%,#e8ddd3 100%);"><i class="fas ${icon}" style="font-size:3rem;color:#d4a574;"></i></div>`
                        }
                        <div class="category-overlay">
                            <i class="fas ${icon}"></i>
                        </div>
                    </div>
                    <h3>${collection.title}</h3>
                    <p>${truncatedDesc || productCount + ' produit' + (productCount > 1 ? 's' : '')}</p>
                    <span class="category-link">Découvrir <i class="fas fa-arrow-right"></i></span>
                </a>
            `;
        }).join('');
        
        if (typeof AOS !== 'undefined') AOS.refresh();
    },
    
    /**
     * Initialize for Shop Page (Router Logic)
     */
    async initShopPage() {
        try {
            await this.init();
            await this.fetchCollections();
            this.buildCollectionFilters();
        } catch (error) {
            console.error('❌ Erreur initialisation boutique:', error);
            this.products = this.products || [];
        }
        
        // Router Logic: Check URL params
        const urlParams = new URLSearchParams(window.location.search);
        const productHandle = urlParams.get('product');
        const filterParam = urlParams.get('filter');
        
        if (productHandle) {
            // State: Product Page
            this.toggleShopView('product');
            await this.loadSingleProduct(productHandle);
        } else {
            // State: Shop Grid
            this.toggleShopView('grid');
            if (filterParam) {
                this.currentFilter = filterParam;
                document.querySelectorAll('.filter-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.filter === filterParam);
                });
            }
            this.setupShopControls();
            this.displayProducts();
        }
    },
    
    /**
     * Toggle between Grid and Product View
     */
    toggleShopView(view) {
        const gridContainer = document.getElementById('shop-container');
        const productContainer = document.getElementById('product-page-container');
        const pageTitle = document.getElementById('pageTitle');
        const pageSubtitle = document.getElementById('pageSubtitle');
        
        if (view === 'product') {
            if(gridContainer) gridContainer.style.display = 'none';
            if(productContainer) productContainer.style.display = 'block';
            if(pageTitle) pageTitle.textContent = "Nos Créations";
            if(pageSubtitle) pageSubtitle.style.display = 'none';
            window.scrollTo(0, 0);
        } else {
            if(gridContainer) gridContainer.style.display = 'block';
            if(productContainer) productContainer.style.display = 'none';
            if(pageTitle) pageTitle.textContent = "Notre Boutique";
            if(pageSubtitle) {
                pageSubtitle.textContent = "Découvrez toutes nos créations florales disponibles à Metz";
                pageSubtitle.style.display = 'block';
            }
        }
    },
    
    /**
     * Load Single Product Page
     */
    async loadSingleProduct(handle) {
        const container = document.getElementById('product-page-container');
        if (!container) return;
        
        // Find product in already loaded products OR fetch it specifically
        let product = this.products.find(p => p.handle === handle);
        
        if (!product) {
            // Fetch specifically if not in initial list (SEO link case)
            // Note: Simplification here, assuming we might need to fetch if list is paginated
            // For now, if not found, we redirect or show error
             container.innerHTML = `
                <div class="container text-center">
                    <h2>Produit introuvable</h2>
                    <p>Désolé, ce produit n'est plus disponible.</p>
                    <a href="boutique.html" class="btn btn-primary">Retour à la boutique</a>
                </div>`;
             return;
        }

        // Update Breadcrumb
        this.updateBreadcrumb(product.title);
        
        // Render Product Page
        const price = parseFloat(product.priceRange.minVariantPrice.amount);
        const currency = product.priceRange.minVariantPrice.currencyCode;
        const formattedPrice = new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(price);
        
        const firstVariant = product.variants.edges[0]?.node;
        const compareAtPrice = firstVariant?.compareAtPriceV2 ? parseFloat(firstVariant.compareAtPriceV2.amount) : null;
        const hasDiscount = compareAtPrice && compareAtPrice > price;
        const formattedComparePrice = hasDiscount ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(compareAtPrice) : '';
        
        const variants = product.variants.edges;
        const hasVariants = variants.length > 1 || variants[0].node.title !== 'Default Title';
        const isOutOfStock = variants.every(v => !v.node.availableForSale || (v.node.quantityAvailable !== null && v.node.quantityAvailable <= 0));
        
        const images = product.images.edges;
        
        // Extract numeric ID from GID for Ymq API call
        const productId = product.id.split('/').pop();
        
        // Render custom options (async, wait for Ymq if needed)
        const customOptionsHTML = await this.renderCustomOptions(product.handle, productId);
        
        container.innerHTML = `
            <div class="container">
                <div class="product-page-grid">
                    <div class="product-gallery">
                        <div class="product-main-image">
                            <img src="${images[0]?.node.url}" alt="${product.title}" id="mainImage">
                        </div>
                        ${images.length > 1 ? `
                            <div class="product-thumbnails">
                                ${images.map((edge, i) => `
                                    <div class="product-thumbnail ${i === 0 ? 'active' : ''}" onclick="ShopifyIntegration.switchImage(this, '${edge.node.url}')">
                                        <img src="${edge.node.url}" alt="${product.title}">
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="product-details-content">
                        <h1>${product.title}</h1>
                        <div class="product-details-price">
                            ${hasDiscount ? `<span class="price-compare">${formattedComparePrice}</span>` : ''}
                            <span class="price-current" data-base-price="${price}">${formattedPrice}</span>
                        </div>
                        
                        <div class="product-description-full">
                            ${product.description}
                        </div>
                        
                        <div class="product-form">
                             ${hasVariants ? `
                                <div class="variant-selector">
                                    ${this.createVariantSelector(variants, product.handle)}
                                </div>
                            ` : ''}
                            
                            ${customOptionsHTML}
                            
                            <div class="add-to-cart-area">
                                ${isOutOfStock ? `
                                <button class="btn btn-lg" style="flex:1; background:#ccc; color:#666; cursor:not-allowed; border:none; padding:14px 24px; border-radius:12px; font-size:1rem; display:flex; align-items:center; justify-content:center; gap:8px;" disabled>
                                    <i class="fas fa-ban"></i>
                                    <span>Rupture de stock</span>
                                </button>
                                ` : `
                                <div class="quantity-input-group">
                                    <button class="quantity-btn" onclick="this.nextElementSibling.stepDown()"><i class="fas fa-minus"></i></button>
                                    <input type="number" value="1" min="1" class="quantity-input" id="pageQuantity">
                                    <button class="quantity-btn" onclick="this.previousElementSibling.stepUp()"><i class="fas fa-plus"></i></button>
                                </div>
                                <button class="btn btn-primary btn-lg" style="flex:1;" onclick="ShopifyIntegration.addToCartFromPage('${product.handle}')">
                                    <i class="fas fa-shopping-bag"></i>
                                    <span>Ajouter au panier</span>
                                </button>
                                `}
                            </div>
                        </div>
                        
                        <div class="product-meta">
                            <div class="meta-item">
                                <i class="fas fa-truck"></i>
                                <span>Expédition en France</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>Livraison Metz & alentours</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-store"></i>
                                <span>Retrait en boutique</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-check-circle"></i>
                                <span>Paiement sécurisé</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Store current product handle for dynamic updates
        this._currentProductHandle = product.handle;

        // Ajouter les événements pour les ronds de couleur + update add-to-cart button
        setTimeout(() => {
            const colorButtons = document.querySelectorAll('.color-button');
            colorButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (button.disabled) return;
                    colorButtons.forEach(b => b.classList.remove('selected'));
                    button.classList.add('selected');
                    this.updateAddToCartButton();
                });
            });

            // Also listen on select dropdowns
            document.querySelectorAll('.variant-select').forEach(select => {
                select.addEventListener('change', () => this.updateAddToCartButton());
            });

            // Auto-select the first available variant
            const firstAvailable = document.querySelector('.color-button:not([disabled])');
            if (firstAvailable && !firstAvailable.classList.contains('selected')) {
                colorButtons.forEach(b => b.classList.remove('selected'));
                firstAvailable.classList.add('selected');
            }

            // Initial check
            this.updateAddToCartButton();

            // Initialiser le prix avec la valeur par défaut du variant-select
            const variantSelect = document.querySelector('.custom-select[data-option]');
            if (variantSelect && typeof ProductOptions !== 'undefined') {
                ProductOptions.updateVariantSelect(variantSelect, product.handle);
            }
        }, 100);
    },

    /**
     * Dynamically update the Add to Cart button based on selected variant availability
     */
    updateAddToCartButton() {
        const handle = this._currentProductHandle;
        if (!handle) return;
        const product = this.products.find(p => p.handle === handle);
        if (!product) return;

        const selectedVariant = this.getSelectedVariant(product);
        const isOOS = !selectedVariant.availableForSale || (selectedVariant.quantityAvailable !== null && selectedVariant.quantityAvailable <= 0);

        const area = document.querySelector('.add-to-cart-area');
        if (!area) return;

        if (isOOS) {
            area.innerHTML = `
                <button class="btn btn-lg" style="flex:1; background:#ccc; color:#666; cursor:not-allowed; border:none; padding:14px 24px; border-radius:12px; font-size:1rem; display:flex; align-items:center; justify-content:center; gap:8px;" disabled>
                    <i class="fas fa-ban"></i>
                    <span>Rupture de stock</span>
                </button>`;
        } else {
            area.innerHTML = `
                <div class="quantity-input-group">
                    <button class="quantity-btn" onclick="this.nextElementSibling.stepDown()"><i class="fas fa-minus"></i></button>
                    <input type="number" value="1" min="1" class="quantity-input" id="pageQuantity">
                    <button class="quantity-btn" onclick="this.previousElementSibling.stepUp()"><i class="fas fa-plus"></i></button>
                </div>
                <button class="btn btn-primary btn-lg" style="flex:1;" onclick="ShopifyIntegration.addToCartFromPage('${handle}')">
                    <i class="fas fa-shopping-bag"></i>
                    <span>Ajouter au panier</span>
                </button>`;
        }
    },
    
    /**
     * Update Breadcrumb
     */
    updateBreadcrumb(productTitle) {
        const container = document.getElementById('breadcrumb-container');
        if(!container) return;
        
        // Récupérer les paramètres URL
        const urlParams = new URLSearchParams(window.location.search);
        const filterParam = urlParams.get('filter');
        
        // Déterminer le nom de la catégorie et le lien
        let categoryLink = 'boutique.html';
        let categoryName = 'Tous les produits';
        
        if (filterParam && filterParam !== 'all') {
            if (filterParam.startsWith('collection:')) {
                const handle = filterParam.replace('collection:', '');
                categoryLink = `boutique.html?filter=${filterParam}`;
                // Récupérer le nom de la collection
                const collection = this.collections.find(c => c.handle === handle);
                categoryName = collection ? collection.title : handle;
            } else {
                categoryLink = `boutique.html?filter=${filterParam}`;
                // Mapping des noms de catégories
                const categoryNames = {
                    'bouquets': 'Bouquets',
                    'peluches': 'Peluches',
                    'plantes': 'Plantes',
                    'nouveautés': 'Nouveautés',
                    'promotions': 'Promotions'
                };
                categoryName = categoryNames[filterParam.toLowerCase()] || filterParam;
            }
        }
        
        container.innerHTML = `
            <a href="index.html"><i class="fas fa-home"></i> Accueil</a>
            <span>/</span>
            <a href="boutique.html">Boutique</a>
            <span>/</span>
            ${filterParam ? `<a href="${categoryLink}">${categoryName}</a>` : ''}
            ${filterParam ? `<span>/</span>` : ''}
            <span>${productTitle}</span>
        `;
    },
    
    /**
     * Switch Gallery Image
     */
    switchImage(thumb, url) {
        document.getElementById('mainImage').src = url;
        document.querySelectorAll('.product-thumbnail').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
    },
    
    /**
     * Get Selected Variant based on current DOM selections
     */
    getSelectedVariant(product) {
        const variants = product.variants.edges;
        
        // If only one variant, return it directly
        if (variants.length === 1) {
            return variants[0].node;
        }
        
        // Collect selected options from the DOM
        const selectedOptions = {};
        
        // Color buttons (round selectors)
        document.querySelectorAll('.color-button.selected').forEach(btn => {
            const optionName = btn.dataset.option;
            const optionValue = btn.dataset.value;
            if (optionName && optionValue) {
                selectedOptions[optionName] = optionValue;
            }
        });
        
        // Dropdown selects (variant-select ET custom-select pour notre système)
        document.querySelectorAll('.variant-select, .custom-select[data-option]').forEach(select => {
            const optionName = select.dataset.option;
            const optionValue = select.value;
            if (optionName && optionValue) {
                selectedOptions[optionName] = optionValue;
            }
        });
        
        // Find the variant matching all selected options
        const matchedVariant = variants.find(edge => {
            return edge.node.selectedOptions.every(opt => {
                if (selectedOptions[opt.name] === undefined) return true;
                return selectedOptions[opt.name] === opt.value;
            });
        });
        
        return matchedVariant ? matchedVariant.node : variants[0].node;
    },

    /**
     * Add to Cart from Page
     */
    addToCartFromPage(handle) {
        const product = this.products.find(p => p.handle === handle);
        if(!product) return;
        
        // Validate custom options if product has them
        if (typeof ProductOptions !== 'undefined' && ProductOptions.hasOptions(handle)) {
            if (!ProductOptions.validateOptions(handle)) {
                return;
            }
        }
        
        // Utiliser le variantId stocké par ProductOptions si disponible (ex: Nombre de roses)
        let selectedVariant = null;
        if (typeof ProductOptions !== 'undefined' && ProductOptions._selectedVariantIds?.[handle]) {
            const vid = ProductOptions._selectedVariantIds[handle];
            selectedVariant = product.variants.edges
                .map(e => e.node)
                .find(v => String(v.id).includes(vid) || String(v.id).endsWith('/' + vid));
        }
        if (!selectedVariant) {
            selectedVariant = this.getSelectedVariant(product);
        }
        
        // Vérifier si le variant sélectionné est en rupture de stock
        if (!selectedVariant.availableForSale || (selectedVariant.quantityAvailable !== null && selectedVariant.quantityAvailable <= 0)) {
            this.showNotification('❌ Ce produit est en rupture de stock', 'error');
            return;
        }
        
        const quantity = parseInt(document.getElementById('pageQuantity').value) || 1;
        
        // Get custom options if any
        let customOptions = null;
        if (typeof ProductOptions !== 'undefined' && ProductOptions.hasOptions(handle)) {
            customOptions = ProductOptions.formatOptionsForCart(handle);
        }
        
        this.addToCart(selectedVariant.id, quantity, customOptions);
    },

    /**
     * Collections data
     */
    collections: [],
    collectionProductIds: {},
    
    /**
     * Fetch Collections from Shopify Storefront API
     */
    async fetchCollections() {
        const query = `
            query {
                collections(first: 50) {
                    edges {
                        node {
                            id
                            title
                            handle
                            description
                            image {
                                url
                            }
                            products(first: 250) {
                                edges {
                                    node {
                                        id
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await this.graphqlRequest(query);
            let collections = response.data.collections.edges.map(edge => edge.node);
            
            // Fetch boutique config to filter hidden collections
            try {
                const configRes = await fetch('https://myflowers-shop.fr/api/boutique-config');
                const config = await configRes.json();
                const hiddenIds = config.hiddenCollections || [];
                this.featuredCollections = config.featuredCollections || [];
                this.hiddenProducts = config.hiddenProducts || [];
                this.featuredProducts = config.featuredProducts || [];
                this.collectionIcons = config.collectionIcons || {};
                this.collectionProductOrders = config.collectionProductOrders || {};
                
                if (hiddenIds.length > 0) {
                    collections = collections.filter(c => {
                        // GID format: gid://shopify/Collection/12345 → extract numeric id
                        const numericId = c.id.split('/').pop();
                        return !hiddenIds.includes(numericId);
                    });
                }
            } catch (e) {
                // Backend not available, show all collections
                this.featuredCollections = [];
                this.hiddenProducts = [];
                this.featuredProducts = [];
                this.collectionIcons = {};
                this.collectionProductOrders = {};
            }
            
            this.collections = collections;
            
            // Build a map of collection handle -> product IDs for fast filtering
            this.collectionProductIds = {};
            this.collections.forEach(collection => {
                this.collectionProductIds[collection.handle] = 
                    collection.products.edges.map(edge => edge.node.id);
            });

            // Populate mobile nav submenu
            this.populateNavSubmenu();
        } catch (error) {
            console.error('❌ Erreur chargement collections:', error);
            this.collections = [];
        }
    },

    /**
     * Populate the Boutique submenu in mobile nav with collection links
     */
    populateNavSubmenu() {
        const submenu = document.getElementById('boutiqueSubmenu');
        if (!submenu || this.collections.length === 0) return;

        // Same icon logic as displayHomepageCollections
        const iconMap = {
            'bouquet': 'fa-spa', 'rose': 'fa-gem', 'éternelle': 'fa-gem', 'eternelle': 'fa-gem',
            'kinder': 'fa-gift', 'box': 'fa-gift', 'coffret': 'fa-gift',
            'peluche': 'fa-heart', 'teddy': 'fa-heart',
            'accessoire': 'fa-ring', 'plante': 'fa-leaf',
            'composition': 'fa-seedling', 'mariage': 'fa-rings-wedding',
        };

        const self = this;
        function getIcon(collection) {
            const numericId = collection.id.split('/').pop();
            if (self.collectionIcons && self.collectionIcons[numericId]) {
                return 'fas ' + self.collectionIcons[numericId];
            }
            const lower = collection.title.toLowerCase();
            for (const [kw, icon] of Object.entries(iconMap)) {
                if (lower.includes(kw)) return 'fas ' + icon;
            }
            return 'fas fa-tag';
        }

        let html = `<li><a href="boutique.html"><i class="fas fa-th-large"></i> Tout voir</a></li>`;

        this.collections.forEach(collection => {
            const icon = getIcon(collection);
            html += `<li><a href="boutique.html?filter=collection:${collection.handle}"><i class="${icon}"></i> ${collection.title}</a></li>`;
        });

        submenu.innerHTML = html;
    },
    
    /**
     * Build dynamic collection filter buttons from Shopify data
     */
    buildCollectionFilters() {
        const filtersContainer = document.getElementById('productFilters');
        if (!filtersContainer || this.collections.length === 0) return;
        
        // Icon mapping based on common collection names (fallback)
        const iconMap = {
            'bouquet': 'fa-spa',
            'rose': 'fa-gem',
            'éternelle': 'fa-gem',
            'eternelle': 'fa-gem',
            'kinder': 'fa-gift',
            'box': 'fa-gift',
            'coffret': 'fa-gift',
            'peluche': 'fa-heart',
            'teddy': 'fa-heart',
            'accessoire': 'fa-ring',
            'plante': 'fa-leaf',
            'composition': 'fa-seedling',
            'mariage': 'fa-rings-wedding',
            'deuil': 'fa-dove',
        };
        
        const self = this;
        function getIconForCollection(collection) {
            // First check saved icons
            const numericId = collection.id.split('/').pop();
            if (self.collectionIcons && self.collectionIcons[numericId]) {
                return self.collectionIcons[numericId];
            }
            // Fallback to keyword detection
            const lower = collection.title.toLowerCase();
            for (const [keyword, icon] of Object.entries(iconMap)) {
                if (lower.includes(keyword)) return icon;
            }
            return 'fa-tag';
        }
        
        // Keep the "Tout Voir" button, add collection buttons
        const collectionButtons = this.collections.map(collection => {
            const icon = getIconForCollection(collection);
            const productCount = collection.products.edges.length;
            return `
                <button class="filter-btn" data-filter="collection:${collection.handle}" title="${productCount} produit${productCount > 1 ? 's' : ''}">
                    <i class="fas ${icon}"></i>
                    <span>${collection.title}</span>
                </button>
            `;
        }).join('');
        
        filtersContainer.innerHTML = `
            <button class="filter-btn active" data-filter="all">
                <i class="fas fa-th"></i>
                <span>Tout Voir</span>
            </button>
            ${collectionButtons}
        `;
    },
    
    /**
     * Fetch Products from Shopify
     */
    async fetchProducts() {
        const query = `
            query {
                products(first: 50) {
                    edges {
                        node {
                            id
                            title
                            description
                            handle
                            tags
                            productType
                            createdAt
                            priceRange {
                                minVariantPrice {
                                    amount
                                    currencyCode
                                }
                            }
                            images(first: 10) {
                                edges {
                                    node {
                                        url
                                        altText
                                    }
                                }
                            }
                            variants(first: 20) {
                                edges {
                                    node {
                                        id
                                        title
                                        priceV2 {
                                            amount
                                            currencyCode
                                        }
                                        compareAtPriceV2 {
                                            amount
                                            currencyCode
                                        }
                                        availableForSale
                                        quantityAvailable
                                        selectedOptions {
                                            name
                                            value
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await this.graphqlRequest(query);
            this.products = response.data.products.edges.map(edge => edge.node);
        } catch (error) {
            console.error('❌ Erreur chargement produits:', error);
            this.products = [];
        }
    },
    
    /**
     * Create Cart
     */
    async createCart() {
        // Vérifier si un cart existe déjà dans le localStorage
        const savedCartId = localStorage.getItem('shopify_cart_id');
        
        if (savedCartId) {
            try {
                // Récupérer le cart existant
                const cart = await this.getCart(savedCartId);
                if (cart) {
                    this.cart = cart;
                    return;
                }
            } catch (error) {
                // Cart invalid, create new one
            }
        }
        
        // Créer un nouveau cart
        const mutation = `
            mutation {
                cartCreate {
                    cart {
                        id
                        checkoutUrl
                        lines(first: 10) {
                            edges {
                                node {
                                    id
                                    quantity
                                    merchandise {
                                        ... on ProductVariant {
                                            id
                                            title
                                            priceV2 {
                                                amount
                                                currencyCode
                                            }
                                            product {
                                                title
                                                images(first: 1) {
                                                    edges {
                                                        node {
                                                            url
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        cost {
                            totalAmount {
                                amount
                                currencyCode
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await this.graphqlRequest(mutation);
            this.cart = response.data.cartCreate.cart;
            localStorage.setItem('shopify_cart_id', this.cart.id);
        } catch (error) {
            console.error('❌ Erreur création panier:', error);
        }
    },
    
    /**
     * Get Cart
     */
    async getCart(cartId) {
        const query = `
            query($cartId: ID!) {
                cart(id: $cartId) {
                    id
                    checkoutUrl
                    lines(first: 50) {
                        edges {
                            node {
                                id
                                quantity
                                merchandise {
                                    ... on ProductVariant {
                                        id
                                        title
                                        priceV2 {
                                            amount
                                            currencyCode
                                        }
                                        product {
                                            title
                                            handle
                                            images(first: 1) {
                                                edges {
                                                    node {
                                                        url
                                                        altText
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    cost {
                        totalAmount {
                            amount
                            currencyCode
                        }
                        subtotalAmount {
                            amount
                            currencyCode
                        }
                    }
                }
            }
        `;
        
        const response = await this.graphqlRequest(query, { cartId });
        return response.data.cart;
    },
    
    /**
     * Add to Cart
     */
    async addToCart(variantId, quantity = 1, customOptions = null) {
        if (!this.cart) {
            await this.createCart();
        }
        
        // Build line attributes from custom options (so they appear in Shopify orders)
        const lineAttributes = [];
        if (customOptions && customOptions.length > 0) {
            customOptions.forEach(opt => {
                lineAttributes.push({
                    key: opt.name,
                    value: `${opt.value}${opt.price > 0 ? ' (+' + opt.price.toFixed(2) + '€)' : ''}`
                });
            });
            // Store total options surcharge as attribute
            const optionsSurcharge = customOptions.reduce((sum, opt) => sum + (opt.price || 0), 0);
            if (optionsSurcharge > 0) {
                lineAttributes.push({
                    key: '_options_surcharge',
                    value: String(optionsSurcharge.toFixed(2))
                });
            }
        }
        
        const mutation = `
            mutation($cartId: ID!, $lines: [CartLineInput!]!) {
                cartLinesAdd(cartId: $cartId, lines: $lines) {
                    cart {
                        id
                        checkoutUrl
                        lines(first: 50) {
                            edges {
                                node {
                                    id
                                    quantity
                                    merchandise {
                                        ... on ProductVariant {
                                            id
                                            title
                                            priceV2 {
                                                amount
                                                currencyCode
                                            }
                                            product {
                                                title
                                                handle
                                                images(first: 1) {
                                                    edges {
                                                        node {
                                                            url
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    attributes {
                                        key
                                        value
                                    }
                                }
                            }
                        }
                        cost {
                            totalAmount {
                                amount
                                currencyCode
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            // Record lines before adding to find the new/updated line
            const linesBefore = this.cart?.lines?.edges?.map(e => ({
                id: e.node.id,
                variantId: e.node.merchandise.id,
                qty: e.node.quantity
            })) || [];
            
            const lineInput = {
                merchandiseId: variantId,
                quantity: quantity
            };
            if (lineAttributes.length > 0) {
                lineInput.attributes = lineAttributes;
            }
            
            const response = await this.graphqlRequest(mutation, {
                cartId: this.cart.id,
                lines: [lineInput]
            });
            
            this.cart = response.data.cartLinesAdd.cart;
            
            // Store custom options in localStorage if present
            if (customOptions && customOptions.length > 0) {
                const linesAfter = this.cart.lines.edges;
                
                // Find the correct line: match by variant ID
                // If a line with this variant already existed, it was updated (qty increased)
                // If not, a new line was created
                let targetLineId = null;
                
                // Strategy 1: Find a new line that wasn't there before
                const newLine = linesAfter.find(edge => 
                    !linesBefore.some(lb => lb.id === edge.node.id)
                );
                if (newLine) {
                    targetLineId = newLine.node.id;
                }
                
                // Strategy 2: If no new line, find the line with matching variant ID
                if (!targetLineId) {
                    const matchingLine = linesAfter.find(edge => 
                        edge.node.merchandise.id === variantId
                    );
                    if (matchingLine) {
                        targetLineId = matchingLine.node.id;
                    }
                }
                
                // Strategy 3: Fallback to last line
                if (!targetLineId && linesAfter.length > 0) {
                    targetLineId = linesAfter[linesAfter.length - 1].node.id;
                }
                
                if (targetLineId) {
                    const cartOptions = JSON.parse(localStorage.getItem('shopify_cart_options') || '{}');
                    cartOptions[targetLineId] = customOptions;
                    localStorage.setItem('shopify_cart_options', JSON.stringify(cartOptions));
                }
            }
            
            this.updateCartUI();
            this.showNotification('✅ Produit ajouté au panier !', 'success');
        } catch (error) {
            console.error('❌ Erreur ajout panier:', error);
            this.showNotification('❌ Erreur lors de l\'ajout au panier', 'error');
        }
    },
    
    /**
     * Update Cart Line
     */
    async updateCartLine(lineId, quantity) {
        const mutation = `
            mutation($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
                cartLinesUpdate(cartId: $cartId, lines: $lines) {
                    cart {
                        id
                        lines(first: 50) {
                            edges {
                                node {
                                    id
                                    quantity
                                    merchandise {
                                        ... on ProductVariant {
                                            id
                                            priceV2 {
                                                amount
                                                currencyCode
                                            }
                                            product {
                                                title
                                                images(first: 1) {
                                                    edges {
                                                        node {
                                                            url
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        cost {
                            totalAmount {
                                amount
                                currencyCode
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await this.graphqlRequest(mutation, {
                cartId: this.cart.id,
                lines: [{
                    id: lineId,
                    quantity: quantity
                }]
            });
            
            this.cart = response.data.cartLinesUpdate.cart;
            this.updateCartUI();
        } catch (error) {
            console.error('❌ Erreur mise à jour panier:', error);
        }
    },
    
    /**
     * Remove from Cart
     */
    async removeFromCart(lineId) {
        const mutation = `
            mutation($cartId: ID!, $lineIds: [ID!]!) {
                cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
                    cart {
                        id
                        lines(first: 50) {
                            edges {
                                node {
                                    id
                                    quantity
                                    merchandise {
                                        ... on ProductVariant {
                                            id
                                            priceV2 {
                                                amount
                                                currencyCode
                                            }
                                            product {
                                                title
                                                images(first: 1) {
                                                    edges {
                                                        node {
                                                            url
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        cost {
                            totalAmount {
                                amount
                                currencyCode
                            }
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await this.graphqlRequest(mutation, {
                cartId: this.cart.id,
                lineIds: [lineId]
            });
            
            this.cart = response.data.cartLinesRemove.cart;
            this.updateCartUI();
            this.showNotification('Produit retiré du panier', 'info');
        } catch (error) {
            console.error('❌ Erreur suppression:', error);
        }
    },
    
    /**
     * GraphQL Request Helper
     */
    async graphqlRequest(query, variables = {}) {
        const response = await fetch(
            `https://${SHOPIFY_CONFIG.storeDomain}/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Storefront-Access-Token': SHOPIFY_CONFIG.storefrontAccessToken
                },
                body: JSON.stringify({ query, variables })
            }
        );
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            throw new Error('GraphQL Error');
        }
        
        return data;
    },
    
    /**
     * Initialize Cart UI
     */
    initCartUI() {
        // Créer l'icône panier dans la navigation
        const navActions = document.querySelector('.nav-actions');
        if (navActions && !document.getElementById('cartButton')) {
            const cartButton = document.createElement('button');
            cartButton.id = 'cartButton';
            cartButton.className = 'cart-button';
            cartButton.innerHTML = `
                <i class="fas fa-shopping-bag"></i>
                <span class="cart-count">0</span>
            `;
            cartButton.addEventListener('click', () => this.toggleCartPanel());
            navActions.prepend(cartButton);
        }
        
        // Créer le panneau panier
        if (!document.getElementById('cartPanel')) {
            const cartPanel = document.createElement('div');
            cartPanel.id = 'cartPanel';
            cartPanel.className = 'cart-panel';
            cartPanel.innerHTML = `
                <div class="cart-overlay"></div>
                <div class="cart-content">
                    <div class="cart-header">
                        <h3><i class="fas fa-shopping-bag"></i> Mon Panier</h3>
                        <button class="cart-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="cart-items" id="cartItemsList"></div>
                    <div class="cart-footer">
                        <div class="cart-total">
                            <span>Total</span>
                            <strong id="cartTotal">0,00 €</strong>
                        </div>
                        <button class="btn btn-primary" id="checkoutButton">
                            <span>Procéder au paiement</span>
                            <i class="fas fa-arrow-right"></i>
                        </button>
                        <button class="btn btn-secondary" id="continueShopping">
                            Continuer mes achats
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(cartPanel);
            
            // Event listeners
            cartPanel.querySelector('.cart-close').addEventListener('click', () => this.toggleCartPanel());
            cartPanel.querySelector('.cart-overlay').addEventListener('click', () => this.toggleCartPanel());
            cartPanel.querySelector('#continueShopping').addEventListener('click', () => this.toggleCartPanel());
            cartPanel.querySelector('#checkoutButton').addEventListener('click', () => this.checkout());
        }
    },
    
    /**
     * Update Cart UI
     */
    updateCartUI() {
        if (!this.cart) return;
        
        const lines = this.cart.lines?.edges || [];
        const count = lines.reduce((sum, edge) => sum + edge.node.quantity, 0);
        
        // Mettre à jour le compteur
        const cartCount = document.querySelector('.cart-count');
        if (cartCount) {
            cartCount.textContent = count;
            cartCount.style.display = count > 0 ? 'flex' : 'none';
        }
        
        // Mettre à jour la liste des produits
        const cartItemsList = document.getElementById('cartItemsList');
        if (cartItemsList) {
            if (lines.length === 0) {
                cartItemsList.innerHTML = `
                    <div class="cart-empty">
                        <i class="fas fa-shopping-bag"></i>
                        <p>Votre panier est vide</p>
                    </div>
                `;
            } else {
                cartItemsList.innerHTML = lines.map(edge => this.createCartItemHTML(edge.node)).join('');
            }
        }

        // Mettre à jour le total (Shopify + options personnalisées)
        const cartTotal = document.getElementById('cartTotal');
        if (cartTotal && this.cart.cost) {
            const shopifyAmount = parseFloat(this.cart.cost.totalAmount.amount);
            const subtotalAmount = parseFloat(this.cart.cost.subtotalAmount?.amount || shopifyAmount);
            
            // Calculer le total des options personnalisées
            const cartOptions = JSON.parse(localStorage.getItem('shopify_cart_options') || '{}');
            const lines = this.cart.lines?.edges || [];
            let optionsTotal = 0;
            lines.forEach(edge => {
                const lineId = edge.node.id;
                const itemOptions = cartOptions[lineId] || [];
                const optionsPrice = itemOptions.reduce((sum, opt) => sum + (opt.price || 0), 0);
                optionsTotal += optionsPrice * edge.node.quantity;
            });
            
            // Use SUBTOTAL instead of totalAmount to avoid shipping charges
            const totalWithOptions = subtotalAmount + optionsTotal;
            
            cartTotal.textContent = new Intl.NumberFormat('fr-FR', {
                style: 'currency',
                currency: this.cart.cost.totalAmount.currencyCode
            }).format(totalWithOptions);
        }
    },
    
    /**
     * Create Cart Item HTML
     */
    createCartItemHTML(item) {
        const product = item.merchandise.product;
        const variant = item.merchandise;
        const image = product.images.edges[0]?.node.url || '';
        const basePrice = parseFloat(variant.priceV2.amount);
        
        // Get custom options from localStorage
        const cartOptions = JSON.parse(localStorage.getItem('shopify_cart_options') || '{}');
        const itemOptions = cartOptions[item.id] || [];
        
        // Calculate options price
        let optionsPrice = 0;
        if (itemOptions.length > 0) {
            optionsPrice = itemOptions.reduce((sum, opt) => sum + (opt.price || 0), 0);
        }
        
        const totalItemPrice = basePrice + optionsPrice;
        const total = totalItemPrice * item.quantity;
        
        // Build options HTML
        let optionsHTML = '';
        if (itemOptions.length > 0) {
            optionsHTML = '<div class="cart-item-options" style="display:flex;flex-direction:column;gap:0.25rem;margin-top:0.4rem;">';
            itemOptions.forEach(opt => {
                optionsHTML += `<span class="cart-option" style="display:block;"><i class="fas fa-check"></i> <strong style="color:#555;">${opt.label || opt.name} :</strong> ${opt.value}${opt.price > 0 ? ' (+' + opt.price.toFixed(2) + '€)' : ''}</span>`;
            });
            optionsHTML += '</div>';
        }
        
        return `
            <div class="cart-item">
                <img src="${image}" alt="${product.title}">
                <div class="cart-item-info">
                    <h4>${product.title}</h4>
                    <p class="cart-item-variant">${variant.title !== 'Default Title' ? variant.title : ''}</p>
                    ${optionsHTML}
                    <div class="cart-item-price">${totalItemPrice.toFixed(2)} €</div>
                </div>
                <div class="cart-item-actions">
                    <div class="quantity-selector">
                        <button onclick="ShopifyIntegration.updateCartLine('${item.id}', ${item.quantity - 1})">
                            <i class="fas fa-minus"></i>
                        </button>
                        <span>${item.quantity}</span>
                        <button onclick="ShopifyIntegration.updateCartLine('${item.id}', ${item.quantity + 1})">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <button class="remove-item" onclick="ShopifyIntegration.removeFromCart('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="cart-item-total">${total.toFixed(2)} €</div>
            </div>
        `;
    },
    
    /**
     * Toggle Cart Panel
     */
    toggleCartPanel() {
        const cartPanel = document.getElementById('cartPanel');
        if (cartPanel) {
            cartPanel.classList.toggle('active');
            const isOpen = cartPanel.classList.contains('active');
            document.body.style.overflow = isOpen ? 'hidden' : '';
            document.documentElement.style.overflow = isOpen ? 'hidden' : '';
        }
    },
    
    /**
     * Checkout - Opens delivery selection first
     */
    checkout() {
        if (!this.cart && this.cartItems.length === 0) return;
        
        // Calculate cart subtotal (Shopify base + custom options surcharges)
        let subtotal = 0;
        let shopifyTotal = 0;
        let optionsTotal = 0;
        
        if (this.cart && this.cart.cost) {
            shopifyTotal = parseFloat(this.cart.cost.totalAmount?.amount || 0);
            subtotal = shopifyTotal;
            
            // Add custom options prices from localStorage
            const cartOptions = JSON.parse(localStorage.getItem('shopify_cart_options') || '{}');
            const lines = this.cart.lines?.edges || [];
            
            lines.forEach((edge, idx) => {
                const lineId = edge.node.id;
                const itemOptions = cartOptions[lineId] || [];
                const lineOptionsPrice = itemOptions.reduce((sum, opt) => sum + (opt.price || 0), 0);
                const lineTotal = lineOptionsPrice * edge.node.quantity;
                optionsTotal += lineTotal;
                subtotal += lineTotal;
            });
        } else {
            // Fallback: calculate from local cart items
            subtotal = this.cartItems.reduce((sum, item) => {
                return sum + (parseFloat(item.price) * item.quantity);
            }, 0);
        }

        // Close cart panel
        this.toggleCartPanel();

        // Open delivery system
        if (typeof DeliverySystem !== 'undefined') {
            DeliverySystem.open(subtotal);
        } else if (this.cart && this.cart.checkoutUrl) {
            // Fallback: direct checkout if delivery system not loaded
            const finalShopifyCartUrl = this.normalizeCheckoutUrl(this.cart.checkoutUrl);
            console.log('FINAL CHECKOUT URL shopify-cart =', finalShopifyCartUrl);
            alert(finalShopifyCartUrl);
            window.location.href = finalShopifyCartUrl;
        }
    },

    buildCheckoutPrefillUrl(checkoutUrl, deliveryInfo = null) {
        checkoutUrl = this.normalizeCheckoutUrl(checkoutUrl);
        if (!checkoutUrl) return checkoutUrl;

        // Check if user is logged in
        const userStr = localStorage.getItem('fleuriste_user');
        let isLoggedIn = false;
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                isLoggedIn = !!user.id; // User is logged in if they have an ID
            } catch (e) {
                console.warn('Could not parse user data:', e);
            }
        }

        // If user is logged in, DO NOT prefill - let Shopify use the account info
        if (isLoggedIn) {
            return checkoutUrl;
        }

        // For guest checkout, prefill if we have delivery info
        if (!deliveryInfo) return checkoutUrl;

        const fullName = String(deliveryInfo.fullName || '').trim();
        const nameParts = fullName.split(/\s+/).filter(Boolean);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        const street = String(deliveryInfo.street || '').trim();
        const city = String(deliveryInfo.city || '').trim();
        const zip = String(deliveryInfo.zip || '').trim();
        const country = String(deliveryInfo.country || 'France').trim();

        if (!street && !city && !zip && !firstName && !lastName) {
            return checkoutUrl;
        }

        try {
            const url = new URL(checkoutUrl);
            if (firstName) url.searchParams.set('checkout[shipping_address][first_name]', firstName);
            if (lastName) url.searchParams.set('checkout[shipping_address][last_name]', lastName);
            if (street) url.searchParams.set('checkout[shipping_address][address1]', street);
            if (zip) url.searchParams.set('checkout[shipping_address][zip]', zip);
            if (city) url.searchParams.set('checkout[shipping_address][city]', city);
            if (country) url.searchParams.set('checkout[shipping_address][country]', country);
            return url.toString();
        } catch {
            return checkoutUrl;
        }
    },

    async getCheckoutUrlWithCustomOptions(note = '', deliveryInfo = null) {
        if (!this.cart || !this.cart.checkoutUrl) return null;

        const lines = this.cart.lines?.edges || [];
        if (lines.length === 0) return this.cart.checkoutUrl;

        const cartOptions = JSON.parse(localStorage.getItem('shopify_cart_options') || '{}');
        
        // Get customer ID if user is logged in
        const userStr = localStorage.getItem('fleuriste_user');
        let customerId = null;
        let isLoggedIn = false;
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                if (user.id) {
                    isLoggedIn = true;
                    // Extract numeric ID from Shopify GraphQL ID format (gid://shopify/Customer/123456789)
                    customerId = user.id.includes('/') ? user.id.split('/').pop() : user.id;
                }
            } catch (e) {
                console.warn('Could not parse user data:', e);
            }
        }

        // Check if there are any options (custom or paid)
        const hasAnyOptions = lines.some(edge => {
            const itemOptions = cartOptions[edge.node.id] || [];
            return Array.isArray(itemOptions) && itemOptions.length > 0;
        });
        
        // Check if this is a Point Relais delivery (no address needed)
        const isPointRelais = deliveryInfo && deliveryInfo.mode === 'france' && deliveryInfo.subMode === 'relais';

        // Always use Draft Order if:
        // 1. There are custom options (to preserve them)
        // 2. User is logged in with customerId (to link order to existing customer)
        // EXCEPT for Point Relais without options - use standard checkout to avoid address form
        if (!hasAnyOptions && (!customerId || isPointRelais)) {
            // Use standard Shopify checkout if NO options and (guest OR point relais)
            return this.buildCheckoutPrefillUrl(this.cart.checkoutUrl, isPointRelais ? null : deliveryInfo);
        }
        
        try {
            const payloadLines = lines.map(edge => {
                const node = edge.node;
                const variantId = String(node.merchandise?.id || '').split('/').pop();
                return {
                    variantId,
                    quantity: node.quantity,
                    title: node.merchandise?.product?.title || 'Produit',
                    options: cartOptions[node.id] || []
                };
            });

            // Use BackendAPI for the request
            let result;
            if (typeof BackendAPI !== 'undefined') {
                result = await BackendAPI.createCustomCheckout(payloadLines, note, deliveryInfo, customerId);
            } else {
                // Fallback to direct fetch
                const response = await fetch('https://myflowers-shop.fr/api/checkout/custom', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lines: payloadLines, note, deliveryInfo, customerId })
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || 'custom checkout request failed');
                }
                result = await response.json();
            }

            if (result.checkoutUrl) {
                return result.checkoutUrl;
            }
        } catch (error) {
            // Fallback to Shopify cart checkout
        }

        return this.buildCheckoutPrefillUrl(this.cart.checkoutUrl, deliveryInfo);
    },
    
    /**
     * Load Cart from Storage
     */
    loadCartFromStorage() {
        const savedCartId = localStorage.getItem('shopify_cart_id');
        if (savedCartId && this.cart) {
            this.updateCartUI();
        }
    },
    
    /**
     * View Product (NAVIGATE TO PAGE)
     */
    viewProduct(handle) {
        // Redirection vers la page produit avec le filtre actuel
        const filterParam = this.currentFilter !== 'all' ? `&filter=${this.currentFilter}` : '';
        window.location.href = `boutique.html?product=${handle}${filterParam}`;
    },
    
    /**
     * Create Variant Selector
     */
    createVariantSelector(variants, productHandle = '') {
        // Récupérer toutes les options
        const options = {};
        variants.forEach(edge => {
            edge.node.selectedOptions.forEach(option => {
                if (!options[option.name]) {
                    options[option.name] = new Set();
                }
                options[option.name].add(option.value);
            });
        });

        // Build a map of option value -> availability
        const variantAvailability = {};
        variants.forEach(edge => {
            const v = edge.node;
            const isAvailable = v.availableForSale && !(v.quantityAvailable !== null && v.quantityAvailable <= 0);
            v.selectedOptions.forEach(opt => {
                const key = `${opt.name}::${opt.value}`;
                // If any variant with this option value is available, mark as available
                if (variantAvailability[key] === undefined) {
                    variantAvailability[key] = isAvailable;
                } else {
                    variantAvailability[key] = variantAvailability[key] || isAvailable;
                }
            });
        });
        
        // Mapping des couleurs par produit
        let colorMap = {
            'Caramel': '#8B5A2B',
            'Beige Clair': '#C4A878'
        };
        
        // Couleurs spécifiques pour le Teddy 80cm
        if (productHandle === 'teddy') {
            colorMap = {
                'Caramel': '#8B5A2B',
                'Beige Clair': '#E8D8B8'
            };
        }
        
        return Object.entries(options).map(([name, values]) => {
            // Si c'est une option "Couleur", afficher des ronds cliquables
            if (name.toLowerCase().includes('couleur') || name.toLowerCase().includes('color')) {
                return `
                    <div class="variant-option">
                        <label>${name}</label>
                        <div class="color-selector">
                            ${[...values].map((value, idx) => {
                                const hexColor = this.getColorHexFromName(value);
                                const isAvailable = variantAvailability[`${name}::${value}`] !== false;
                                return `
                                    <button class="color-button ${idx === 0 ? 'selected' : ''} ${!isAvailable ? 'out-of-stock' : ''}" 
                                            data-option="${name}" 
                                            data-value="${value}"
                                            data-available="${isAvailable}"
                                            style="background-color: ${hexColor}${!isAvailable ? ';opacity:0.4;cursor:not-allowed;' : ''}"
                                            title="${value}${!isAvailable ? ' (Rupture de stock)' : ''}"
                                            ${!isAvailable ? 'disabled' : ''}>
                                        ${!isAvailable ? '<span style="position:absolute;top:50%;left:-2px;right:-2px;height:2px;background:#333;transform:rotate(-45deg);"></span>' : ''}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
            
            // Sinon, utiliser une liste déroulante classique
            return `
                <div class="variant-option">
                    <label>${name}</label>
                    <select class="variant-select" data-option="${name}">
                        ${[...values].map(value => {
                            const isAvailable = variantAvailability[`${name}::${value}`] !== false;
                            return `
                                <option value="${value}" ${!isAvailable ? 'disabled' : ''}>${value}${!isAvailable ? ' (Rupture)' : ''}</option>
                            `;
                        }).join('')}
                    </select>
                </div>
            `;
        }).join('');
    },
    
    /**
     * Render Custom Product Options (Ymq-style)
     */
    async renderCustomOptions(productHandle, productId = null) {
        // Check if ProductOptions system is loaded
        if (typeof ProductOptions === 'undefined') {
            return '';
        }
        
        // Store base price for later calculations
        this._basePrice = parseFloat(this.products.find(p => p.handle === productHandle)?.priceRange.minVariantPrice.amount || 0);
        
        // Try to load options (will check local config first, then Ymq if productId provided)
        const optionsHTML = await ProductOptions.renderOptions(productHandle, productId);
        
        return optionsHTML || '';
    },
    
    /**
     * Get Color Hex from French Color Name
     */
    getColorHexFromName(colorName) {
        const colorMap = {
            // Marrons et taupes
            'marron': '#8B4513',
            'brun': '#8B4513',
            'caramel': '#8B5A2B',
            'chocolat': '#7B3F00',
            'taupe': '#8B8680',
            'beige': '#D2B48C',
            'beige clair': '#D2B48C',
            'crème': '#FFFDD0',
            'crema': '#FFFDD0',
            'sable': '#C2B280',
            
            // Roses
            'rose': '#FFB6C1',
            'rose clair': '#FFB6D9',
            'rose foncé': '#C71585',
            'rose pâle': '#FFB6C1',
            'rose poudré': '#F8BBD0',
            'fuchsia': '#FF00FF',
            'magenta': '#FF00FF',
            
            // Rouges
            'rouge': '#FF0000',
            'rouge foncé': '#8B0000',
            'rouge clair': '#FF6B6B',
            'bordeaux': '#800020',
            'lie de vin': '#722F37',
            'vermillon': '#FF4500',
            
            // Bleus
            'bleu': '#0000FF',
            'bleu clair': '#87CEEB',
            'bleu foncé': '#00008B',
            'bleu marine': '#000080',
            'bleu ciel': '#87CEEB',
            'bleu électrique': '#7F00FF',
            'turquoise': '#40E0D0',
            'cyan': '#00FFFF',
            
            // Verts
            'vert': '#008000',
            'vert clair': '#90EE90',
            'vert foncé': '#006400',
            'vert menthe': '#98FF98',
            'vert olive': '#808000',
            'vert émeraude': '#50C878',
            'salade': '#7FFF00',
            
            // Jaunes et oranges
            'jaune': '#FFFF00',
            'jaune clair': '#FFFFE0',
            'jaune foncé': '#FFD700',
            'or': '#FFD700',
            'orange': '#FFA500',
            'orange clair': '#FFDAB9',
            'abricot': '#FBCF60',
            'pêche': '#FFDAB9',
            
            // Violets et mauves
            'violet': '#8B00FF',
            'mauve': '#E0B0FF',
            'lavande': '#E6E0E6',
            'lilas': '#C8A2C8',
            'prune': '#6F2DA8',
            
            // Blancs et gris
            'blanc': '#FFFFFF',
            'ivoire': '#FFFFF0',
            'gris': '#808080',
            'gris clair': '#D3D3D3',
            'gris foncé': '#A9A9A9',
            'ardoise': '#708090',
            'gris souris': '#909090',
            'gris perle': '#E5E1E6',
            
            // Noirs
            'noir': '#000000',
            'charbon': '#36454F',
            
            // Spéciaux
            'nude': '#E4B69D',
            'peau': '#E4B69D',
            'corail': '#FF7F50',
            'saumon': '#FA8072',
            'crevette': '#FBAED2',
            'champagne': '#F7E7CE',
            'écru': '#F1EDD0',
            'ciel': '#87CEEB',
            'turquoise': '#40E0D0',
        };
        
        // Normaliser le nom (minuscules, sans espaces extras)
        const normalizedName = colorName.trim().toLowerCase();
        
        // Chercher une correspondance exacte
        if (colorMap[normalizedName]) {
            return colorMap[normalizedName];
        }
        
        // Chercher une correspondance partielle
        for (const [key, hex] of Object.entries(colorMap)) {
            if (normalizedName.includes(key) || key.includes(normalizedName)) {
                return hex;
            }
        }
        
        // Défaut: gris si couleur non trouvée
        return '#CCCCCC';
    },

    /**
     * Show Notification
     */
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },    
    /**
     * Display Featured Products
     */
    displayFeaturedProducts() {
        const grid = document.getElementById('featured-products');
        if (!grid) return;
        
        let featured = [];
        
        // Use admin-configured featured products if available
        if (this.featuredProducts && this.featuredProducts.length > 0) {
            featured = this.products.filter(p => {
                const numericId = p.id.split('/').pop();
                return this.featuredProducts.includes(numericId);
            });
        }
        
        // Fallback ONLY if no admin selection exists at all
        if (featured.length === 0) {
            featured = this.products.filter(p => 
                p.tags.includes('featured') || p.tags.includes('nouveau') || p.tags.includes('promo')
            ).slice(0, 6);
            
            if (featured.length === 0) {
                featured = this.products.slice(0, 6);
            }
        }
        
        // Filter out hidden products
        if (this.hiddenProducts && this.hiddenProducts.length > 0) {
            featured = featured.filter(p => {
                const numericId = p.id.split('/').pop();
                return !this.hiddenProducts.includes(numericId);
            });
        }
        
        if (featured.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Aucun produit disponible</p>';
            return;
        }
        
        grid.innerHTML = featured.map(product => this.createProductCard(product)).join('');
        
        if (typeof AOS !== 'undefined') AOS.refresh();
    },
    
    /**
     * Display Products (Shop Page)
     */
    displayProducts() {
        const grid = document.getElementById('products-grid');
        const pagination = document.getElementById('pagination');
        const resultsCount = document.getElementById('resultsCount');
        
        if (!grid) return;
        
        let filteredProducts = this.getFilteredAndSortedProducts();
        
        if (resultsCount) {
            resultsCount.textContent = `${filteredProducts.length} produit${filteredProducts.length > 1 ? 's' : ''} trouvé${filteredProducts.length > 1 ? 's' : ''}`;
        }
        
        const start = (this.currentPage - 1) * this.productsPerPage;
        const end = start + this.productsPerPage;
        const paginatedProducts = filteredProducts.slice(start, end);
        
        if (paginatedProducts.length === 0) {
            const message = this.products.length === 0
                ? `<div class="no-products" style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem;">
                    <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
                    <h3>Impossible de charger les produits</h3>
                    <p style="color: var(--text-light);">Une erreur est survenue. Veuillez rafraîchir la page.</p>
                    <button onclick="window.location.reload()" class="btn btn-primary" style="margin-top:1rem;">Réessayer</button>
                  </div>`
                : `<div class="no-products" style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem;">
                    <i class="fas fa-search" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
                    <h3>Aucun produit trouvé</h3>
                    <p style="color: var(--text-light);">Essayez de changer de filtre ou de recherche</p>
                  </div>`;
            grid.innerHTML = message;
            if (pagination) pagination.style.display = 'none';
        } else {
            grid.innerHTML = paginatedProducts.map(product => this.createProductCard(product)).join('');
            
            if (pagination && filteredProducts.length > this.productsPerPage) {
                this.updatePagination(filteredProducts.length);
                pagination.style.display = 'flex';
            } else if (pagination) {
                pagination.style.display = 'none';
            }
        }
        
        if (typeof AOS !== 'undefined') AOS.refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    
    /**
     * Create Product Card
     */
    createProductCard(product) {
        const price = parseFloat(product.priceRange.minVariantPrice.amount);
        const currency = product.priceRange.minVariantPrice.currencyCode;
        const formattedPrice = new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: currency
        }).format(price);
        
        // Check for compare at price (prix barré)
        const firstVariant = product.variants.edges[0]?.node;
        const compareAtPrice = firstVariant?.compareAtPriceV2 ? parseFloat(firstVariant.compareAtPriceV2.amount) : null;
        const hasDiscount = compareAtPrice && compareAtPrice > price;
        const formattedComparePrice = hasDiscount ? new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: currency
        }).format(compareAtPrice) : '';
        
        const image = product.images.edges[0]?.node.url || 'https://via.placeholder.com/400x400?text=No+Image';
        const imageAlt = product.images.edges[0]?.node.altText || product.title;
        
        const isNew = product.tags.includes('nouveau') || product.tags.includes('new');
        const isPromo = product.tags.includes('promo') || product.tags.includes('promotion') || hasDiscount;
        const isProductOutOfStock = product.variants.edges.every(v => !v.node.availableForSale || (v.node.quantityAvailable !== null && v.node.quantityAvailable <= 0));
        
        // Calculate discount percentage for badge
        let promoBadgeText = 'Promo';
        if (hasDiscount) {
            const discountPercent = Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
            promoBadgeText = `-${discountPercent}%`;
        }
        
        const badge = isProductOutOfStock ? '<div class="product-badge" style="background: #888;">Rupture de stock</div>' :
                      isNew ? '<div class="product-badge">Nouveau</div>' : 
                      isPromo ? `<div class="product-badge" style="background: #ef4444;">${promoBadgeText}</div>` : '';

        // Check if user is logged in for favorites
        const user = JSON.parse(localStorage.getItem('fleuriste_user') || 'null');
        const favKey = user ? 'fleuriste_favorites_' + user.id : null;
        const favorites = favKey ? JSON.parse(localStorage.getItem(favKey) || '[]') : [];
        const isFav = favorites.some(f => f.id === product.id);
        const favClass = isFav ? 'fav-btn active' : 'fav-btn';
        
        const priceHTML = hasDiscount
            ? `<span class="price-compare">${formattedComparePrice}</span> <span class="price-current">${formattedPrice}</span>`
            : formattedPrice;
        
        return `
            <div class="product-card" data-aos="fade-up">
                <div class="product-image" onclick="ShopifyIntegration.viewProduct('${product.handle}')">
                    <img src="${image}" alt="${imageAlt}" loading="lazy">
                    ${badge}
                </div>
                <button class="${favClass}" onclick="event.stopPropagation(); ShopifyIntegration.toggleFavorite('${product.id}', '${product.title.replace(/'/g, "\\'")}', '${price}', '${image}')" title="Ajouter aux favoris">
                    <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
                </button>
                <div class="product-info">
                    <h3 class="product-title">${product.title}</h3>
                    <p class="product-description">${this.truncateText(product.description, 100)}</p>
                    <div class="product-price">${priceHTML}</div>
                    <div class="product-actions">
                        <button class="btn btn-primary" onclick="ShopifyIntegration.viewProduct('${product.handle}')">
                            <span>Voir détails</span>
                            <i class="fas fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },
    
    /**
     * Get Filtered and Sorted Products
     */
    getFilteredAndSortedProducts() {
        let filtered = [...this.products];
        
        // Filter out hidden products
        if (this.hiddenProducts && this.hiddenProducts.length > 0) {
            filtered = filtered.filter(p => {
                const numericId = p.id.split('/').pop();
                return !this.hiddenProducts.includes(numericId);
            });
        }
        
        // Collection-based filtering (from Shopify)
        if (this.currentFilter !== 'all') {
            if (this.currentFilter.startsWith('collection:')) {
                const handle = this.currentFilter.replace('collection:', '');
                const productIds = this.collectionProductIds[handle] || [];
                
                if (productIds.length > 0) {
                    filtered = filtered.filter(product => productIds.includes(product.id));
                } else {
                    filtered = [];
                }
            } else {
                // Legacy keyword-based filtering (fallback)
                const filterKeywords = {
                    'bouquets': ['bouquet', 'bouquets', 'fleur', 'fleurs', 'rose rouge', 'composition'],
                    'rose-sous-cloche': ['rose éternelle', 'roses éternelles', 'rose sous cloche', 'cloche', 'éternelle', 'eternelle'],
                    'box-kinder': ['box kinder', 'kinder', 'box', 'coffret'],
                    'peluches': ['peluche', 'peluches', 'teddy', 'nounours', 'ours'],
                    'accessoires': ['accessoire', 'accessoires', 'vase', 'ruban', 'papillon', 'personnalisation']
                };
                
                const keywords = filterKeywords[this.currentFilter] || [this.currentFilter];
                
                filtered = filtered.filter(product => {
                    const tags = product.tags.map(tag => tag.toLowerCase());
                    const title = product.title.toLowerCase();
                    const description = (product.description || '').toLowerCase();
                    const productType = (product.productType || '').toLowerCase();
                    
                    if (tags.includes(this.currentFilter.toLowerCase())) return true;
                    
                    return keywords.some(keyword => {
                        const kw = keyword.toLowerCase();
                        return tags.some(tag => tag.includes(kw)) ||
                               title.includes(kw) ||
                               productType.includes(kw) ||
                               description.includes(kw);
                    });
                });
            }
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(product => 
                product.title.toLowerCase().includes(query) ||
                product.description.toLowerCase().includes(query) ||
                product.tags.some(tag => tag.toLowerCase().includes(query))
            );
        }
        
        switch (this.currentSort) {
            case 'price-asc':
                filtered.sort((a, b) => 
                    parseFloat(a.priceRange.minVariantPrice.amount) - parseFloat(b.priceRange.minVariantPrice.amount)
                );
                break;
            case 'price-desc':
                filtered.sort((a, b) => 
                    parseFloat(b.priceRange.minVariantPrice.amount) - parseFloat(a.priceRange.minVariantPrice.amount)
                );
                break;
            case 'name-asc':
                filtered.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'name-desc':
                filtered.sort((a, b) => b.title.localeCompare(a.title));
                break;
            case 'newest':
                filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                break;
            default:
                // Apply custom product order per collection when sorting is "default"
                if (this.currentFilter && this.currentFilter.startsWith('collection:') && this.collectionProductOrders) {
                    const handle = this.currentFilter.replace('collection:', '');
                    const customOrder = this.collectionProductOrders[handle];
                    if (customOrder && customOrder.length > 0) {
                        filtered.sort((a, b) => {
                            const aId = a.id.split('/').pop();
                            const bId = b.id.split('/').pop();
                            const aIdx = customOrder.indexOf(aId);
                            const bIdx = customOrder.indexOf(bId);
                            // Products not in custom order go to end
                            const aPosn = aIdx === -1 ? 999999 : aIdx;
                            const bPosn = bIdx === -1 ? 999999 : bIdx;
                            return aPosn - bPosn;
                        });
                    }
                }
                break;
        }
        
        return filtered;
    },
    
    /**
     * Setup Shop Controls
     */
    setupShopControls() {
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                this.currentPage = 1;
                this.displayProducts();
            });
        });
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.currentPage = 1;
                this.displayProducts();
            });
        }
        
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.currentPage = 1;
                this.displayProducts();
            });
        }
        
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.displayProducts();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const filtered = this.getFilteredAndSortedProducts();
                const maxPages = Math.ceil(filtered.length / this.productsPerPage);
                if (this.currentPage < maxPages) {
                    this.currentPage++;
                    this.displayProducts();
                }
            });
        }
    },
    
    /**
     * Update Pagination
     */
    updatePagination(totalProducts) {
        const maxPages = Math.ceil(totalProducts / this.productsPerPage);
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageNumbers = document.getElementById('pageNumbers');
        
        if (!prevBtn || !nextBtn || !pageNumbers) return;
        
        prevBtn.disabled = this.currentPage === 1;
        nextBtn.disabled = this.currentPage === maxPages;
        
        let numbersHTML = '';
        for (let i = 1; i <= maxPages; i++) {
            if (i === 1 || i === maxPages || (i >= this.currentPage - 1 && i <= this.currentPage + 1)) {
                numbersHTML += `
                    <div class="page-number ${i === this.currentPage ? 'active' : ''}" 
                         onclick="ShopifyIntegration.goToPage(${i})">
                        ${i}
                    </div>
                `;
            } else if (i === this.currentPage - 2 || i === this.currentPage + 2) {
                numbersHTML += '<span style="padding: 0 0.5rem;">...</span>';
            }
        }
        pageNumbers.innerHTML = numbersHTML;
    },
    
    /**
     * Go to Page
     */
    goToPage(page) {
        this.currentPage = page;
        this.displayProducts();
    },
    
    /**
     * Toggle Favorite
     */
    toggleFavorite(productId, title, price, image) {
        const user = JSON.parse(localStorage.getItem('fleuriste_user') || 'null');
        if (!user) {
            // Afficher juste une notification discrète sans redirection
            if (typeof AuthSystem !== 'undefined' && AuthSystem.showNotification) {
                AuthSystem.showNotification('Connectez-vous pour gérer vos favoris', 'error');
            }
            return;
        }
        const key = 'fleuriste_favorites_' + user.id;
        let favorites = JSON.parse(localStorage.getItem(key) || '[]');
        const exists = favorites.findIndex(f => f.id === productId);
        
        if (exists >= 0) {
            favorites.splice(exists, 1);
            localStorage.setItem(key, JSON.stringify(favorites));
            if (typeof AuthSystem !== 'undefined' && AuthSystem.showNotification) {
                AuthSystem.showNotification('Retiré des favoris', 'success');
            }
        } else {
            favorites.push({ id: productId, title, price, image });
            localStorage.setItem(key, JSON.stringify(favorites));
            if (typeof AuthSystem !== 'undefined' && AuthSystem.showNotification) {
                AuthSystem.showNotification('Ajouté aux favoris ♥', 'success');
            }
        }
        
        // Update heart icon
        const btn = document.querySelector(`.fav-btn[onclick*="${productId}"]`);
        if (!btn) {
            // Refresh all cards
            if (this.products && this.products.length > 0) {
                const grid = document.querySelector('.products-grid, .featured-grid');
                if (grid) {
                    // Re-render to update heart states
                    this.displayShopProducts?.();
                }
            }
            return;
        }
        const icon = btn.querySelector('i');
        if (exists >= 0) {
            btn.classList.remove('active');
            icon.className = 'far fa-heart';
        } else {
            btn.classList.add('active');
            icon.className = 'fas fa-heart';
        }
    },

    /**
     * Truncate Text
     */
    truncateText(text, length) {
        if (!text) return '';
        if (text.length <= length) return text;
        return text.substring(0, length) + '...';
    }
};

// Export
window.ShopifyIntegration = ShopifyIntegration;
