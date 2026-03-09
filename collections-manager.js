/* ===================================
   Shopify Collections Manager
   Gère les collections Shopify (Bouquets, Roses Éternelles, etc.)
   ================================ */

class ShopifyCollectionsManager {
    constructor() {
        this.collections = [];
        this.hiddenCollections = [];
        this.featuredCollections = [];
        this.collectionIcons = {};
        this.apiUrl = 'https://myflowers-shop.fr/api';
        this.collectionImages = null; // { type: 'file'|'url'|'existing', src, file? }
        // collectionUploadTarget removed — collections have only one image
        
        // Available icons for collections
        this.availableIcons = [
            { icon: 'fa-spa', name: 'Spa/Fleur' },
            { icon: 'fa-seedling', name: 'Pousse' },
            { icon: 'fa-leaf', name: 'Feuille' },
            { icon: 'fa-heart', name: 'Cœur' },
            { icon: 'fa-gift', name: 'Cadeau' },
            { icon: 'fa-gem', name: 'Diamant' },
            { icon: 'fa-star', name: 'Étoile' },
            { icon: 'fa-crown', name: 'Couronne' },
            { icon: 'fa-ring', name: 'Bague' },
            { icon: 'fa-dove', name: 'Colombe' },
            { icon: 'fa-feather', name: 'Plume' },
            { icon: 'fa-sun', name: 'Soleil' },
            { icon: 'fa-moon', name: 'Lune' },
            { icon: 'fa-snowflake', name: 'Flocon' },
            { icon: 'fa-fire', name: 'Feu' },
            { icon: 'fa-bolt', name: 'Éclair' },
            { icon: 'fa-rainbow', name: 'Arc-en-ciel' },
            { icon: 'fa-candy-cane', name: 'Sucre d\'orge' },
            { icon: 'fa-cookie', name: 'Cookie' },
            { icon: 'fa-ice-cream', name: 'Glace' },
            { icon: 'fa-cake-candles', name: 'Gâteau' },
            { icon: 'fa-champagne-glasses', name: 'Champagne' },
            { icon: 'fa-ribbon', name: 'Ruban' },
            { icon: 'fa-palette', name: 'Palette' },
            { icon: 'fa-wand-magic-sparkles', name: 'Baguette' },
            { icon: 'fa-hand-holding-heart', name: 'Don' },
            { icon: 'fa-hands-holding-heart', name: 'Mains cœur' },
            { icon: 'fa-paw', name: 'Patte' },
            { icon: 'fa-dog', name: 'Chien' },
            { icon: 'fa-cat', name: 'Chat' },
            { icon: 'fa-hippo', name: 'Hippo' },
            { icon: 'fa-horse', name: 'Cheval' },
            { icon: 'fa-dragon', name: 'Dragon' },
            { icon: 'fa-kiwi-bird', name: 'Oiseau' },
            { icon: 'fa-butterfly', name: 'Papillon' },
            { icon: 'fa-bug', name: 'Coccinelle' },
            { icon: 'fa-tree', name: 'Arbre' },
            { icon: 'fa-mountain-sun', name: 'Montagne' },
            { icon: 'fa-umbrella-beach', name: 'Plage' },
            { icon: 'fa-bell', name: 'Cloche' },
            { icon: 'fa-tag', name: 'Tag' },
            { icon: 'fa-tags', name: 'Tags' },
            { icon: 'fa-basket-shopping', name: 'Panier' },
            { icon: 'fa-bag-shopping', name: 'Sac' },
            { icon: 'fa-box-open', name: 'Boîte' },
            { icon: 'fa-truck', name: 'Livraison' },
            { icon: 'fa-clock', name: 'Horloge' },
            { icon: 'fa-calendar', name: 'Calendrier' },
        ];
        
        this.selectedIcon = 'fa-tag';
        this.init();
    }

    async init() {
        await this.loadBoutiqueConfig();
        this.loadCollections();
        this.setupEventListeners();
        this.initIconSelector();
    }

    async loadBoutiqueConfig() {
        try {
            const response = await fetch(`${this.apiUrl}/boutique-config`);
            const data = await response.json();
            this.hiddenCollections = data.hiddenCollections || [];
            this.featuredCollections = data.featuredCollections || [];
            this.collectionIcons = data.collectionIcons || {};
            this.collectionProductOrders = data.collectionProductOrders || {};
            this.collectionsOrder = data.collectionsOrder || [];
        } catch (e) {
            this.hiddenCollections = [];
            this.featuredCollections = [];
            this.collectionIcons = {};
            this.collectionProductOrders = {};
            this.collectionsOrder = [];
        }
    }
    
    // Initialize icon selector
    initIconSelector() {
        const iconGrid = document.getElementById('iconGrid');
        if (!iconGrid) return;
        
        iconGrid.innerHTML = this.availableIcons.map(({ icon, name }) => `
            <button type="button" class="icon-option ${icon === this.selectedIcon ? 'selected' : ''}" 
                    data-icon="${icon}" title="${name}"
                    style="width: 40px; height: 40px; border: 2px solid #e5e7eb; border-radius: 8px; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;">
                <i class="fas ${icon}" style="font-size: 1rem; color: #374151;"></i>
            </button>
        `).join('');
        
        // Add click handlers
        iconGrid.querySelectorAll('.icon-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectIcon(btn.dataset.icon);
            });
        });
    }
    
    selectIcon(icon) {
        this.selectedIcon = icon;
        document.getElementById('collectionIcon').value = icon;
        
        // Update preview
        const preview = document.getElementById('selectedIconPreview');
        const nameEl = document.getElementById('selectedIconName');
        if (preview) {
            preview.innerHTML = `<i class="fas ${icon}" style="color: #fff; font-size: 1.5rem;"></i>`;
        }
        if (nameEl) {
            const iconData = this.availableIcons.find(i => i.icon === icon);
            nameEl.textContent = iconData ? iconData.name : icon;
        }
        
        // Update selected state
        document.querySelectorAll('#iconGrid .icon-option').forEach(btn => {
            if (btn.dataset.icon === icon) {
                btn.classList.add('selected');
                btn.style.borderColor = '#5B1013';
                btn.style.background = '#fef2f2';
            } else {
                btn.classList.remove('selected');
                btn.style.borderColor = '#e5e7eb';
                btn.style.background = '#fff';
            }
        });
    }

    setupEventListeners() {
        // Add Collection Button
        document.getElementById('addCollectionBtn')?.addEventListener('click', () => {
            this.openCollectionModal();
        });

        // Reorder Collections
        document.getElementById('reorderCollectionsBtn')?.addEventListener('click', () => {
            this.openCollectionsReorderPanel();
        });
        document.getElementById('saveCollectionsOrderBtn')?.addEventListener('click', () => {
            this.saveCollectionsOrder();
        });
        document.getElementById('cancelCollectionsOrderBtn')?.addEventListener('click', () => {
            this.cancelCollectionsReorder();
        });



        // Quick actions
        document.querySelector('[data-action="new-collection"]')?.addEventListener('click', () => {
            this.openCollectionModal();
        });

        document.querySelector('[data-action="manage-collections"]')?.addEventListener('click', () => {
            document.querySelector('[data-section="collections"]')?.click();
        });

        // Collection Form Submit
        document.getElementById('collectionForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveCollection();
        });

        // Cancel Button
        document.getElementById('cancelCollectionBtn')?.addEventListener('click', () => {
            this.closeCollectionModal();
        });

        // Modal Close
        document.querySelector('#collectionModal .modal-close')?.addEventListener('click', () => {
            this.closeCollectionModal();
        });

        // Auto-generate handle from title
        document.getElementById('collectionTitle')?.addEventListener('input', (e) => {
            const handleInput = document.getElementById('collectionHandle');
            if (!handleInput.value || handleInput.dataset.autoGenerated === 'true') {
                handleInput.value = this.generateHandle(e.target.value);
                handleInput.dataset.autoGenerated = 'true';
            }
        });

        document.getElementById('collectionHandle')?.addEventListener('input', (e) => {
            if (e.target.value) {
                e.target.dataset.autoGenerated = 'false';
            }
        });

        // File input change
        document.getElementById('collectionImageFile')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                this.collectionImages = { type: 'file', src: URL.createObjectURL(file), file };
                this.renderCollectionGallery();
            }
            e.target.value = '';
        });

        // Dropzone interactions
        const dropzone = document.getElementById('collectionImageDropzone');
        if (dropzone) {
            dropzone.addEventListener('click', () => {
                document.getElementById('collectionImageFile').click();
            });
            dropzone.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') document.getElementById('collectionImageFile').click();
            });
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = '#5B1013';
                dropzone.style.background = '#fef2f2';
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.style.borderColor = '';
                dropzone.style.background = '';
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = '';
                dropzone.style.background = '';
                const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
                if (file) {
                    this.collectionImages = { type: 'file', src: URL.createObjectURL(file), file };
                    this.renderCollectionGallery();
                }
            });
        }

    
    }

    // Load collections from Shopify
    async loadCollections() {
        const grid = document.getElementById('collectionsGrid');
        if (!grid) return;

        // Show loading
        grid.innerHTML = `
            <div class="collections-loading" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #6b7280; margin-bottom: 1rem;"></i>
                <p style="color: #6b7280;">Chargement des collections depuis Shopify...</p>
            </div>
        `;

        try {
            const response = await fetch(`${this.apiUrl}/collections`);
            const data = await response.json();
            
            if (data.collections) {
                this.collections = data.collections;
                this.renderCollections();
            } else if (data.custom_collections) {
                // Fallback for old format
                this.collections = data.custom_collections;
                this.renderCollections();
            } else {
                throw new Error('Erreur lors du chargement des collections');
            }
        } catch (error) {
            console.error('Error loading collections:', error);
            // MODIFICATION: Styles forcés avec !important pour la taille du bouton
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ef4444; margin-bottom: 1rem;"></i>
                    <h3>Erreur de chargement</h3>
                    <p style="color: #6b7280; margin-bottom: 1.5rem;">${error.message}</p>
                    <button class="btn btn-primary" onclick="window.collectionsManager.loadCollections()" style="display: inline-flex !important; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 1rem !important; width: auto !important; margin: 0 auto; font-size: 0.9rem !important; height: auto !important; min-height: 0 !important;">
                        <i class="fas fa-redo"></i>
                        <span>Réessayer</span>
                    </button>
                </div>
            `;
        }
    }

    // Render collections grid
    renderCollections() {
        const grid = document.getElementById('collectionsGrid');
        if (!grid) return;

        if (this.collections.length === 0) {
            // MODIFICATION: Styles forcés ici aussi
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                    <i class="fas fa-folder-open" style="font-size: 2rem; color: #9ca3af; margin-bottom: 1rem;"></i>
                    <h3>Aucune collection</h3>
                    <p style="color: #6b7280; margin-bottom: 1.5rem;">Créez votre première collection de produits Shopify</p>
                    <button class="btn btn-primary" id="emptyStateAddBtn" style="display: inline-flex !important; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 1rem !important; width: auto !important; margin: 0 auto; font-size: 0.9rem !important; height: auto !important; min-height: 0 !important;">
                        <i class="fas fa-plus"></i>
                        <span>Créer une collection</span>
                    </button>
                </div>
            `;
            
            document.getElementById('emptyStateAddBtn')?.addEventListener('click', () => {
                this.openCollectionModal();
            });
            return;
        }

        // Apply saved collections order before rendering
        let orderedCollections = [...this.collections];
        if (this.collectionsOrder && this.collectionsOrder.length > 0) {
            const orderMap = {};
            this.collectionsOrder.forEach((id, idx) => { orderMap[String(id)] = idx; });
            orderedCollections.sort((a, b) => {
                const posA = orderMap[String(a.id)] !== undefined ? orderMap[String(a.id)] : 9999;
                const posB = orderMap[String(b.id)] !== undefined ? orderMap[String(b.id)] : 9999;
                return posA - posB;
            });
        }
        grid.innerHTML = orderedCollections.map(collection => this.getCollectionCardHTML(collection)).join('');

        // Add event listeners
        this.collections.forEach(collection => {
            document.querySelector(`[data-edit-collection="${collection.id}"]`)?.addEventListener('click', () => {
                this.editCollection(collection.id);
            });

            document.querySelector(`[data-delete-collection="${collection.id}"]`)?.addEventListener('click', () => {
                this.deleteCollection(collection.id);
            });

            document.querySelector(`[data-toggle-products="${collection.id}"]`)?.addEventListener('click', (e) => {
                this.toggleProducts(collection.id, e.currentTarget);
            });

            document.querySelector(`[data-toggle-boutique="${collection.id}"]`)?.addEventListener('click', () => {
                this.toggleBoutiqueVisibility(collection.id);
            });

            document.querySelector(`[data-toggle-featured="${collection.id}"]`)?.addEventListener('click', () => {
                this.toggleFeatured(collection.id);
            });

            document.querySelector(`[data-promo-collection="${collection.id}"]`)?.addEventListener('click', () => {
                this.openBulkPromoModal(collection);
            });

            // Reorder buttons
            document.querySelector(`[data-reorder-collection="${collection.id}"]`)?.addEventListener('click', () => {
                this.enableReorderMode(collection);
            });
            document.querySelector(`[data-save-order="${collection.id}"]`)?.addEventListener('click', () => {
                this.saveProductOrder(collection);
            });
            document.querySelector(`[data-cancel-order="${collection.id}"]`)?.addEventListener('click', () => {
                this.cancelReorderMode(collection);
            });
            document.querySelector(`[data-reset-order="${collection.id}"]`)?.addEventListener('click', () => {
                this.resetProductOrder(collection);
            });
        });
    }

    // Get HTML for a collection card
    getCollectionCardHTML(collection) {
        const imageUrl = collection.image?.src || '';
        const publishedStatus = collection.published_at ? 'visible' : 'hidden';
        const productCount = collection.products_count || 0;
        let products = collection.products || [];
        
        // Apply saved custom order if available
        const savedOrder = this.collectionProductOrders?.[collection.handle];
        if (savedOrder && savedOrder.length > 0 && products.length > 0) {
            products = [...products].sort((a, b) => {
                const aId = String(a.id).split('/').pop();
                const bId = String(b.id).split('/').pop();
                const aIdx = savedOrder.indexOf(aId);
                const bIdx = savedOrder.indexOf(bId);
                const aPosn = aIdx === -1 ? 999999 : aIdx;
                const bPosn = bIdx === -1 ? 999999 : bIdx;
                return aPosn - bPosn;
            });
        }
        
        const hasCustomOrder = savedOrder && savedOrder.length > 0;
        
        const productsHTML = products.length > 0 ? products.map((product, index) => {
            const productImage = product.images?.[0]?.src || '';
            const variant = product.variants?.[0];
            const price = variant?.price || '0.00';
            const compareAtPrice = variant?.compare_at_price;
            const hasPromo = compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price);
            const productNumericId = String(product.id).split('/').pop();
            
            return `
                <div class="collection-product-item${hasPromo ? ' has-promo' : ''}" data-product-id="${productNumericId}" data-product-index="${index}">
                    <span class="drag-handle" title="Glisser pour réordonner"><i class="fas fa-grip-vertical"></i></span>
                    <span class="product-order-number">${index + 1}</span>
                    ${productImage ? 
                        `<img src="${productImage}" alt="${product.title}" class="collection-product-thumb">` :
                        `<div class="collection-product-thumb no-image"><i class="fas fa-image"></i></div>`
                    }
                    <div class="collection-product-info">
                        <span class="collection-product-name">${product.title}</span>
                        <span class="collection-product-price">
                            ${hasPromo ? `<span class="original-price">${parseFloat(compareAtPrice).toFixed(2)}€</span>` : ''}
                            <span class="${hasPromo ? 'promo-price' : ''}">${parseFloat(price).toFixed(2)} €</span>
                            ${hasPromo ? '<i class="fas fa-fire promo-icon"></i>' : ''}
                        </span>
                    </div>
                </div>
            `;
        }).join('') : '<p class="no-products-msg">Aucun produit dans cette collection</p>';
        
        const isVisibleInBoutique = !this.hiddenCollections.includes(String(collection.id));
        const isFeatured = this.featuredCollections.includes(String(collection.id));
        
        return `
            <div class="category-card" data-collection-id="${collection.id}">
                ${imageUrl ? 
                    `<img src="${imageUrl}" alt="${collection.title}" class="category-card-image">` :
                    `<div class="category-card-image" style="display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);">
                        <i class="fas fa-image" style="font-size: 3rem; color: #9ca3af;"></i>
                    </div>`
                }
                <div class="category-card-content">
                    <div class="category-card-header">
                        <h3 class="category-card-title">${collection.title}</h3>
                    </div>
                    <div class="collection-toggles-row">
                        <div class="boutique-toggle ${isVisibleInBoutique ? 'is-active' : ''}" data-toggle-boutique="${collection.id}">
                            <div class="boutique-toggle-track"><div class="boutique-toggle-thumb"></div></div>
                            <div class="boutique-toggle-text">${isVisibleInBoutique ? 'Visible en boutique' : 'Masqué de la boutique'}</div>
                        </div>
                        <div class="featured-toggle ${isFeatured ? 'is-active' : ''}" data-toggle-featured="${collection.id}" title="${isFeatured ? 'Retirer de l\'accueil' : 'Mettre en avant sur l\'accueil'}">
                            <i class="fa${isFeatured ? 's' : 'r'} fa-star"></i>
                            <div class="featured-toggle-text">${isFeatured ? 'Sur l\'accueil' : 'Pas sur l\'accueil'}</div>
                        </div>
                    </div>
                    ${collection.body_html ? 
                        `<p class="category-card-description">${this.stripHtml(collection.body_html)}</p>` : 
                        ''
                    }
                    <div class="category-card-meta">
                        <span class="category-card-slug">
                            <i class="fas fa-box"></i> ${productCount} produit${productCount > 1 ? 's' : ''}
                        </span>
                        <div class="category-card-actions">
                            <button class="category-action-btn view" data-toggle-products="${collection.id}" title="Voir les produits">
                                <i class="fas fa-chevron-down"></i>
                            </button>
                            ${collection.collection_type !== 'smart' ? `
                                <button class="category-action-btn edit" data-edit-collection="${collection.id}" title="Modifier">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="category-action-btn delete" data-delete-collection="${collection.id}" title="Supprimer">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="collection-products-list" id="products-${collection.id}" style="display:none;" data-collection-handle="${collection.handle}">
                        <div class="collection-products-header">
                            <strong>Produits (${productCount})${hasCustomOrder ? '<span class="collection-has-custom-order"><i class="fas fa-sort"></i> Ordre personnalisé</span>' : ''}</strong>
                            <div class="collection-products-actions">
                                ${productCount > 1 ? `
                                    <button class="btn-collection-reorder" data-reorder-collection="${collection.id}" title="Réorganiser l'ordre d'affichage des produits">
                                        <i class="fas fa-sort"></i>
                                        <span>Réorganiser</span>
                                    </button>
                                    <button class="btn-collection-save-order" data-save-order="${collection.id}" style="display:none;" title="Sauvegarder l'ordre">
                                        <i class="fas fa-check"></i>
                                        <span>Sauvegarder l'ordre</span>
                                    </button>
                                    <button class="btn-collection-cancel-order" data-cancel-order="${collection.id}" style="display:none;" title="Annuler">
                                        <i class="fas fa-times"></i>
                                        <span>Annuler</span>
                                    </button>
                                    <button class="btn-collection-reset-order" data-reset-order="${collection.id}" style="display:none;" title="Remettre l'ordre par défaut">
                                        <i class="fas fa-undo"></i>
                                        <span>Réinitialiser</span>
                                    </button>
                                ` : ''}
                                ${productCount > 0 ? `
                                    <button class="btn-collection-promo" data-promo-collection="${collection.id}" title="Appliquer une promotion à tous les produits">
                                        <i class="fas fa-fire"></i>
                                        <span>Promo sur toute la collection</span>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                        <div class="collection-products-grid" id="products-grid-${collection.id}">
                            ${productsHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Open collection modal
    openCollectionModal(collection = null) {
        this.currentCollection = collection;
        const modal = document.getElementById('collectionModal');
        const title = document.getElementById('collectionModalTitle');
        
        // Reset image state
        this.collectionImages = null;
        this.renderCollectionGallery();

        if (collection) {
            title.textContent = 'Modifier la collection';
            this.fillCollectionForm(collection);
        } else {
            title.textContent = 'Créer une collection';
            document.getElementById('collectionForm').reset();
            document.getElementById('collectionId').value = '';
            this.selectIcon('fa-tag');
        }

        modal.classList.add('active');
    }

    // Close collection modal
    closeCollectionModal() {
        const modal = document.getElementById('collectionModal');
        modal.classList.remove('active');
        this.currentCollection = null;
        this.collectionImages = null;
        this.renderCollectionGallery();
        document.getElementById('collectionForm').reset();
        this.selectIcon('fa-tag');
    }

    // Fill form with collection data
    fillCollectionForm(collection) {
        document.getElementById('collectionId').value = collection.id;
        document.getElementById('collectionTitle').value = collection.title;
        document.getElementById('collectionHandle').value = collection.handle;
        document.getElementById('collectionDescription').value = this.stripHtml(collection.body_html || '');
        document.getElementById('collectionHandle').dataset.autoGenerated = 'false';

        // Load existing image
        this.collectionImages = null;
        if (collection.image?.src) {
            this.collectionImages = { type: 'existing', src: collection.image.src };
            this.renderCollectionGallery();
        }
        
        // Load saved icon or detect from title
        const collectionId = collection.id.toString().split('/').pop();
        const savedIcon = this.collectionIcons[collectionId];
        if (savedIcon) {
            this.selectIcon(savedIcon);
        } else {
            const detectedIcon = this.detectIconFromTitle(collection.title);
            this.selectIcon(detectedIcon);
        }
    }
    
    // Detect icon from collection title
    detectIconFromTitle(title) {
        const lower = title.toLowerCase();
        const iconMap = {
            'bouquet': 'fa-spa',
            'rose': 'fa-gem',
            'éternelle': 'fa-gem',
            'eternelle': 'fa-gem',
            'stabilisée': 'fa-gem',
            'cloche': 'fa-gem',
            'kinder': 'fa-gift',
            'box': 'fa-gift',
            'coffret': 'fa-gift',
            'peluche': 'fa-heart',
            'teddy': 'fa-heart',
            'ours': 'fa-heart',
            'accessoire': 'fa-ring',
            'plante': 'fa-leaf',
            'composition': 'fa-seedling',
        };
        
        for (const [keyword, icon] of Object.entries(iconMap)) {
            if (lower.includes(keyword)) return icon;
        }
        return 'fa-tag';
    }

    // Save collection to Shopify
    async saveCollection() {
        const id = document.getElementById('collectionId').value;
        const title = document.getElementById('collectionTitle').value.trim();
        const handle = document.getElementById('collectionHandle').value.trim() || this.generateHandle(title);
        const description = document.getElementById('collectionDescription').value.trim();
        const published = true; // Géré par le toggle "Visible en boutique"

        if (!title) {
            this.showNotification('Le titre de la collection est requis', 'error');
            return;
        }

        // Prepare Shopify collection data
        const collectionData = {
            custom_collection: {
                title,
                handle,
                body_html: description,
                published: published
            }
        };

        // Image : une seule image possible pour une collection Shopify
        if (this.collectionImages) {
            if (this.collectionImages.type === 'file' && this.collectionImages.file) {
                const base64 = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result.split(',')[1]);
                    reader.readAsDataURL(this.collectionImages.file);
                });
                collectionData.custom_collection.image = {
                    attachment: base64,
                    filename: this.collectionImages.file.name
                };
            } else if (this.collectionImages.type === 'url') {
                collectionData.custom_collection.image = { src: this.collectionImages.src };
            }
            // type 'existing' → pas de changement
        }

        // Disable submit button
        const submitBtn = document.querySelector('#collectionForm button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Sauvegarde...</span>';

        try {
            const url = id 
                ? `${this.apiUrl}/collections/${id}`
                : `${this.apiUrl}/collections`;
            
            const method = id ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(collectionData)
            });
            
            let result = await response.json();
            
            // Si le handle est déjà pris, réessayer avec un suffixe unique
            if (result.errors?.handle) {
                const uniqueHandle = handle + '-' + Date.now().toString().slice(-5);
                collectionData.custom_collection.handle = uniqueHandle;
                const retry = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectionData)
                });
                result = await retry.json();
            }

            if (result.custom_collection) {
                const collectionId = result.custom_collection.id.toString();
                const icon = document.getElementById('collectionIcon').value || 'fa-tag';
                await this.saveCollectionIcon(collectionId, icon);
                
                this.showNotification(
                    id ? 'Collection modifiée avec succès' : 'Collection créée avec succès',
                    'success'
                );
                this.closeCollectionModal();
                await this.loadCollections();
            } else {
                const errorMsg = result.errors 
                    ? Object.entries(result.errors).map(([k,v]) => `${k}: ${v}`).join(', ')
                    : 'Erreur lors de la sauvegarde';
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('Error saving collection:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }
    
    // Save collection icon to boutique-config
    async saveCollectionIcon(collectionId, icon) {
        try {
            this.collectionIcons[collectionId] = icon;
            
            const response = await fetch(`${this.apiUrl}/boutique-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collectionIcons: this.collectionIcons })
            });
            
            if (!response.ok) {
                console.warn('Could not save collection icon');
            }
        } catch (error) {
            console.warn('Error saving collection icon:', error);
        }
    }

    // Edit collection
    editCollection(id) {
        const collection = this.collections.find(c => c.id === id);
        if (collection) {
            this.openCollectionModal(collection);
        }
    }

    // Delete collection from Shopify
    async deleteCollection(id) {
        const collection = this.collections.find(c => c.id === id);
        if (!collection) return;

        if (!confirm(`Êtes-vous sûr de vouloir supprimer la collection "${collection.title}" ?\n\n⚠️ Cette action supprimera la collection de Shopify !`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiUrl}/collections/${id}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('Collection supprimée avec succès', 'success');
                await this.loadCollections();
            } else {
                throw new Error(result.error || 'Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Error deleting collection:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        }
    }

    // Publish collection to all sales channels
    async publishCollection(id) {
        const collection = this.collections.find(c => c.id === id);
        if (!collection) return;

        const btn = document.querySelector(`[data-publish-collection="${id}"]`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const response = await fetch(`${this.apiUrl}/collections/${id}/publish`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`"${collection.title}" publiée sur tous les canaux de vente`, 'success');
            } else {
                throw new Error(result.error || 'Erreur lors de la publication');
            }
        } catch (error) {
            console.error('Error publishing collection:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-globe"></i>';
            }
        }
    }

    // Toggle products visibility in collection card
    // Toggle collection visibility in boutique
    async toggleBoutiqueVisibility(collectionId) {
        const toggleEl = document.querySelector(`[data-toggle-boutique="${collectionId}"]`);
        
        try {
            const response = await fetch(`${this.apiUrl}/boutique-config/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collectionId: String(collectionId) })
            });
            const result = await response.json();
            this.hiddenCollections = result.hiddenCollections || [];
            
            if (toggleEl) {
                if (result.visible) {
                    toggleEl.classList.add('is-active');
                } else {
                    toggleEl.classList.remove('is-active');
                }
                const textEl = toggleEl.querySelector('.boutique-toggle-text');
                if (textEl) {
                    textEl.textContent = result.visible ? 'Visible en boutique' : 'Masqué de la boutique';
                }
            }
            
            this.showNotification(
                result.visible ? 'Collection visible en boutique' : 'Collection masquée de la boutique',
                'success'
            );
        } catch (error) {
            console.error('Error toggling visibility:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        }
    }

    async toggleFeatured(collectionId) {
        const toggleEl = document.querySelector(`[data-toggle-featured="${collectionId}"]`);
        
        try {
            const response = await fetch(`${this.apiUrl}/boutique-config/toggle-featured`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collectionId: String(collectionId) })
            });
            const result = await response.json();
            this.featuredCollections = result.featuredCollections || [];
            
            if (toggleEl) {
                const icon = toggleEl.querySelector('i');
                const text = toggleEl.querySelector('.featured-toggle-text');
                if (result.featured) {
                    toggleEl.classList.add('is-active');
                    if (icon) icon.className = 'fas fa-star';
                    if (text) text.textContent = 'Sur l\'accueil';
                    toggleEl.title = 'Retirer de l\'accueil';
                } else {
                    toggleEl.classList.remove('is-active');
                    if (icon) icon.className = 'far fa-star';
                    if (text) text.textContent = 'Pas sur l\'accueil';
                    toggleEl.title = 'Mettre en avant sur l\'accueil';
                }
            }
            
            this.showNotification(
                result.featured ? 'Collection mise en avant sur l\'accueil' : 'Collection retirée de l\'accueil',
                'success'
            );
        } catch (error) {
            console.error('Error toggling featured:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        }
    }

    toggleProducts(collectionId, button) {
        const productsList = document.getElementById(`products-${collectionId}`);
        if (!productsList) return;
        
        const isVisible = productsList.style.display !== 'none';
        productsList.style.display = isVisible ? 'none' : 'block';
        
        // Rotate chevron icon
        const icon = button.querySelector('i');
        if (icon) {
            icon.className = isVisible ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        }
    }

    // ===== PRODUCT REORDER FUNCTIONALITY =====
    
    enableReorderMode(collection) {
        const grid = document.getElementById(`products-grid-${collection.id}`);
        const list = document.getElementById(`products-${collection.id}`);
        if (!grid || !list) return;
        
        // Show/hide buttons
        const reorderBtn = document.querySelector(`[data-reorder-collection="${collection.id}"]`);
        const saveBtn = document.querySelector(`[data-save-order="${collection.id}"]`);
        const cancelBtn = document.querySelector(`[data-cancel-order="${collection.id}"]`);
        const resetBtn = document.querySelector(`[data-reset-order="${collection.id}"]`);
        if (reorderBtn) reorderBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'inline-flex';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        if (resetBtn) resetBtn.style.display = 'inline-flex';
        
        // Add reorder-mode class
        grid.classList.add('reorder-mode');
        list.classList.add('reorder-active');
        
        // Save original order for cancel
        this._originalOrder = Array.from(grid.querySelectorAll('.collection-product-item')).map(el => el.dataset.productId);
        
        // Enable drag and drop
        this.initDragAndDrop(grid, collection.id);
    }
    
    cancelReorderMode(collection) {
        const grid = document.getElementById(`products-grid-${collection.id}`);
        const list = document.getElementById(`products-${collection.id}`);
        if (!grid || !list) return;
        
        // Restore original order
        if (this._originalOrder) {
            const items = Array.from(grid.querySelectorAll('.collection-product-item'));
            this._originalOrder.forEach(id => {
                const item = items.find(el => el.dataset.productId === id);
                if (item) grid.appendChild(item);
            });
            this.updateOrderNumbers(grid);
        }
        
        this.disableReorderMode(collection);
    }
    
    disableReorderMode(collection) {
        const grid = document.getElementById(`products-grid-${collection.id}`);
        const list = document.getElementById(`products-${collection.id}`);
        if (!grid || !list) return;
        
        // Show/hide buttons
        const reorderBtn = document.querySelector(`[data-reorder-collection="${collection.id}"]`);
        const saveBtn = document.querySelector(`[data-save-order="${collection.id}"]`);
        const cancelBtn = document.querySelector(`[data-cancel-order="${collection.id}"]`);
        const resetBtn = document.querySelector(`[data-reset-order="${collection.id}"]`);
        if (reorderBtn) reorderBtn.style.display = 'inline-flex';
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
        
        grid.classList.remove('reorder-mode');
        list.classList.remove('reorder-active');
        this._originalOrder = null;
    }
    
    initDragAndDrop(grid, collectionId) {
        const items = grid.querySelectorAll('.collection-product-item');
        let draggedItem = null;
        let placeholder = null;
        
        items.forEach(item => {
            // Remove old listeners by cloning
            const handle = item.querySelector('.drag-handle');
            if (!handle) return;
            
            item.setAttribute('draggable', 'true');
            
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.productId);
                
                // Create placeholder
                placeholder = document.createElement('div');
                placeholder.className = 'drag-placeholder';
                placeholder.style.height = item.offsetHeight + 'px';
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.removeChild(placeholder);
                }
                placeholder = null;
                this.updateOrderNumbers(grid);
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                if (!draggedItem || draggedItem === item) return;
                
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                
                if (e.clientY < midY) {
                    grid.insertBefore(draggedItem, item);
                } else {
                    grid.insertBefore(draggedItem, item.nextSibling);
                }
            });
        });
        
        // Also handle touch events for mobile
        this.initTouchDragAndDrop(grid, collectionId);
    }
    
    initTouchDragAndDrop(grid, collectionId) {
        const items = grid.querySelectorAll('.collection-product-item');
        let draggedItem = null;
        let startY = 0;
        let currentY = 0;
        
        items.forEach(item => {
            const handle = item.querySelector('.drag-handle');
            if (!handle) return;
            
            handle.addEventListener('touchstart', (e) => {
                draggedItem = item;
                startY = e.touches[0].clientY;
                item.classList.add('dragging');
                e.preventDefault();
            }, { passive: false });
        });
        
        grid.addEventListener('touchmove', (e) => {
            if (!draggedItem) return;
            e.preventDefault();
            
            currentY = e.touches[0].clientY;
            
            const siblings = Array.from(grid.querySelectorAll('.collection-product-item:not(.dragging)'));
            const closest = siblings.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = currentY - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset, element: child };
                }
                return closest;
            }, { offset: Number.NEGATIVE_INFINITY });
            
            if (closest.element) {
                grid.insertBefore(draggedItem, closest.element);
            } else {
                grid.appendChild(draggedItem);
            }
        }, { passive: false });
        
        grid.addEventListener('touchend', () => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                this.updateOrderNumbers(grid);
            }
        });
    }
    
    updateOrderNumbers(grid) {
        const items = grid.querySelectorAll('.collection-product-item');
        items.forEach((item, index) => {
            const numEl = item.querySelector('.product-order-number');
            if (numEl) numEl.textContent = index + 1;
        });
    }
    
    async saveProductOrder(collection) {
        const grid = document.getElementById(`products-grid-${collection.id}`);
        const list = document.getElementById(`products-${collection.id}`);
        if (!grid || !list) return;
        
        const handle = list.dataset.collectionHandle;
        const productIds = Array.from(grid.querySelectorAll('.collection-product-item')).map(el => el.dataset.productId);
        
        try {
            const response = await fetch(`${this.apiUrl}/boutique-config/collection-product-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collectionHandle: handle, productIds })
            });
            
            const data = await response.json();
            if (data.success) {
                this.showNotification(`Ordre des produits sauvegardé pour "${collection.title}"`, 'success');
                this.disableReorderMode(collection);
            } else {
                throw new Error(data.error || 'Erreur inconnue');
            }
        } catch (error) {
            console.error('Error saving product order:', error);
            this.showNotification(`Erreur : ${error.message}`, 'error');
        }
    }
    
    async resetProductOrder(collection) {
        const list = document.getElementById(`products-${collection.id}`);
        if (!list) return;
        
        const handle = list.dataset.collectionHandle;
        
        if (!confirm(`Remettre l'ordre par défaut pour "${collection.title}" ?\nL'ordre personnalisé sera supprimé.`)) return;
        
        try {
            const response = await fetch(`${this.apiUrl}/boutique-config/collection-product-order/${handle}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                this.showNotification(`Ordre par défaut restauré pour "${collection.title}"`, 'success');
                this.disableReorderMode(collection);
                await this.loadCollections();
            } else {
                throw new Error(data.error || 'Erreur inconnue');
            }
        } catch (error) {
            console.error('Error resetting product order:', error);
            this.showNotification(`Erreur : ${error.message}`, 'error');
        }
    }

    // Generate handle from title
    generateHandle(str) {
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Strip HTML tags
    // Open bulk promo modal
    openBulkPromoModal(collection) {
        this.currentPromoCollection = collection;
        
        // Create modal if not exists
        let modal = document.getElementById('bulkPromoModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bulkPromoModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content" style="max-width: 500px;">
                    <button class="modal-close" onclick="window.collectionsManager.closeBulkPromoModal()">
                        <i class="fas fa-times"></i>
                    </button>
                    <div class="modal-header" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); margin: -1.5rem -1.5rem 1.5rem; padding: 1.5rem; border-radius: 12px 12px 0 0;">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <div style="width: 50px; height: 50px; background: rgba(255,255,255,0.2); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-fire" style="color: #fff; font-size: 1.5rem;"></i>
                            </div>
                            <div>
                                <h2 style="color: #fff; margin: 0; font-size: 1.25rem;">Promotion sur la collection</h2>
                                <p id="bulkPromoCollectionName" style="color: rgba(255,255,255,0.8); margin: 0; font-size: 0.85rem;"></p>
                            </div>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                                <i class="fas fa-info-circle" style="color: #d97706; margin-top: 2px;"></i>
                                <div style="font-size: 0.85rem; color: #92400e;">
                                    Cette action appliquera une réduction à <strong>tous les produits</strong> de cette collection.
                                    Le prix original sera conservé comme prix barré.
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-group" style="text-align: center;">
                            <label style="font-weight: 600; color: #374151; margin-bottom: 1rem; display: block;">Pourcentage de réduction</label>
                            <div style="display: flex; align-items: center; justify-content: center; gap: 1rem;">
                                <button type="button" onclick="document.getElementById('bulkPromoPercentage').value = Math.max(1, parseInt(document.getElementById('bulkPromoPercentage').value) - 5); window.collectionsManager.updateBulkPromoPreview();" 
                                        style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #dc2626; background: #fff; cursor: pointer; font-size: 1.3rem; color: #dc2626; font-weight: bold;">
                                    −
                                </button>
                                <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px; padding: 0.75rem 1.5rem; min-width: 130px; box-shadow: 0 4px 15px rgba(220, 38, 38, 0.3);">
                                    <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                                        <input type="number" id="bulkPromoPercentage" min="1" max="99" value="20" 
                                               style="width: 80px; padding: 0.5rem; border: none; border-radius: 6px; font-size: 1.5rem; text-align: center; font-weight: 700; background: #fff; color: #dc2626; -moz-appearance: textfield;"
                                               onchange="window.collectionsManager.updateBulkPromoPreview()">
                                        <span style="font-weight: 700; color: #fff; font-size: 1.5rem;">%</span>
                                    </div>
                                </div>
                                <button type="button" onclick="document.getElementById('bulkPromoPercentage').value = Math.min(99, parseInt(document.getElementById('bulkPromoPercentage').value) + 5); window.collectionsManager.updateBulkPromoPreview();" 
                                        style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #dc2626; background: #fff; cursor: pointer; font-size: 1.3rem; color: #dc2626; font-weight: bold;">
                                    +
                                </button>
                            </div>
                        </div>
                        
                        <div id="bulkPromoPreview" style="background: #f3f4f6; border-radius: 8px; padding: 1rem; margin: 1.5rem 0; max-height: 300px; overflow-y: auto;">
                            <div style="text-align: center; color: #6b7280; font-size: 0.85rem;">Aperçu de la promotion</div>
                        </div>
                        
                        <div class="modal-actions" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            <button type="button" class="btn" id="removeBulkPromoBtn" style="background: #6b7280; color: #fff; border: none; flex: 1;" onclick="window.collectionsManager.removeBulkPromo()">
                                <i class="fas fa-times"></i>
                                <span>Retirer les promos</span>
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="window.collectionsManager.closeBulkPromoModal()" style="flex: 1;">
                                Annuler
                            </button>
                            <button type="button" class="btn" id="applyBulkPromoBtn" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff; border: none; flex: 2;" onclick="window.collectionsManager.applyBulkPromo()">
                                <i class="fas fa-fire"></i>
                                <span>Appliquer la promotion</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        // Update modal content
        document.getElementById('bulkPromoCollectionName').textContent = collection.title;
        document.getElementById('bulkPromoPercentage').value = 20;
        this.showAllPromoProducts = false; // Reset to show only 3 products initially
        this.updateBulkPromoPreview();
        
        modal.classList.add('active');
    }
    
    // Close bulk promo modal
    closeBulkPromoModal() {
        const modal = document.getElementById('bulkPromoModal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.currentPromoCollection = null;
        this.showAllPromoProducts = false;
    }
    
    // Update bulk promo preview
    updateBulkPromoPreview() {
        const collection = this.currentPromoCollection;
        if (!collection) return;
        
        const percentage = parseInt(document.getElementById('bulkPromoPercentage').value) || 20;
        const products = collection.products || [];
        const preview = document.getElementById('bulkPromoPreview');
        
        if (products.length === 0) {
            preview.innerHTML = `<div style="text-align: center; color: #9ca3af;">Aucun produit dans cette collection</div>`;
            return;
        }
        
        // Check if we should show all products
        const showAll = this.showAllPromoProducts || false;
        const displayProducts = showAll ? products : products.slice(0, 3);
        
        const productsList = displayProducts.map(product => {
            const originalPrice = parseFloat(product.variants?.[0]?.price || 0);
            const compareAt = product.variants?.[0]?.compare_at_price;
            const hasExistingPromo = compareAt && parseFloat(compareAt) > originalPrice;
            const newPrice = originalPrice * (1 - percentage / 100);
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.5rem; border-bottom: 1px solid #e5e7eb; background: ${hasExistingPromo ? 'rgba(254, 243, 199, 0.5)' : 'transparent'}; border-radius: 4px; margin-bottom: 2px;">
                    <span style="font-size: 0.85rem; color: #374151; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 0.5rem;">${product.title}</span>
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;">
                        <span style="font-size: 0.8rem; color: #9ca3af; text-decoration: line-through;">${originalPrice.toFixed(2)}€</span>
                        <span style="font-size: 0.95rem; color: #dc2626; font-weight: 700;">${newPrice.toFixed(2)}€</span>
                        ${hasExistingPromo ? '<i class="fas fa-fire" style="color: #f59e0b; font-size: 0.7rem;" title="Déjà en promo"></i>' : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        const remainingCount = products.length - 3;
        
        preview.innerHTML = `
            <div style="text-align: center; color: #6b7280; font-size: 0.8rem; margin-bottom: 0.75rem; font-weight: 600;">
                <i class="fas fa-tags" style="margin-right: 0.5rem;"></i>
                ${showAll ? `${products.length} produits` : `Aperçu (${products.length} produits au total)`}
            </div>
            <div id="promoProductsList">
                ${productsList}
            </div>
            ${!showAll && products.length > 3 ? `
                <button type="button" onclick="window.collectionsManager.showAllPromoProducts = true; window.collectionsManager.updateBulkPromoPreview();" 
                        style="width: 100%; margin-top: 0.75rem; padding: 0.6rem; background: #e5e7eb; border: none; border-radius: 8px; cursor: pointer; font-size: 0.85rem; color: #374151; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background 0.2s;">
                    <i class="fas fa-chevron-down"></i>
                    Afficher les ${remainingCount} autre${remainingCount > 1 ? 's' : ''} produit${remainingCount > 1 ? 's' : ''}
                </button>
            ` : ''}
            ${showAll && products.length > 3 ? `
                <button type="button" onclick="window.collectionsManager.showAllPromoProducts = false; window.collectionsManager.updateBulkPromoPreview();" 
                        style="width: 100%; margin-top: 0.75rem; padding: 0.6rem; background: #e5e7eb; border: none; border-radius: 8px; cursor: pointer; font-size: 0.85rem; color: #374151; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background 0.2s;">
                    <i class="fas fa-chevron-up"></i>
                    Réduire la liste
                </button>
            ` : ''}
        `;
    }
    
    // Apply bulk promo to collection
    async applyBulkPromo() {
        const collection = this.currentPromoCollection;
        if (!collection) return;
        
        const percentage = parseInt(document.getElementById('bulkPromoPercentage').value) || 20;
        const products = collection.products || [];
        
        if (products.length === 0) {
            this.showNotification('Aucun produit dans cette collection', 'error');
            return;
        }
        
        if (!confirm(`Êtes-vous sûr de vouloir appliquer une réduction de ${percentage}% à tous les ${products.length} produit${products.length > 1 ? 's' : ''} de la collection "${collection.title}" ?`)) {
            return;
        }
        
        const btn = document.getElementById('applyBulkPromoBtn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Application en cours...</span>';
        
        try {
            const response = await fetch(`${this.apiUrl}/collections/${collection.id}/bulk-promo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ percentage })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`Promotion de ${percentage}% appliquée à ${result.updatedCount} produit${result.updatedCount > 1 ? 's' : ''} !`, 'success');
                this.closeBulkPromoModal();
                // Reload collections to show updated prices
                await this.loadCollections();
            } else {
                throw new Error(result.error || 'Erreur lors de l\'application de la promotion');
            }
        } catch (error) {
            console.error('Error applying bulk promo:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
    
    // Remove bulk promo from collection
    async removeBulkPromo() {
        const collection = this.currentPromoCollection;
        if (!collection) return;
        
        const products = collection.products || [];
        
        if (products.length === 0) {
            this.showNotification('Aucun produit dans cette collection', 'error');
            return;
        }
        
        if (!confirm(`Êtes-vous sûr de vouloir retirer les promotions de tous les ${products.length} produit${products.length > 1 ? 's' : ''} de la collection "${collection.title}" ?\n\nLe prix original sera restauré.`)) {
            return;
        }
        
        const btn = document.getElementById('removeBulkPromoBtn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const response = await fetch(`${this.apiUrl}/collections/${collection.id}/bulk-promo/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`Promotions retirées de ${result.updatedCount} produit${result.updatedCount > 1 ? 's' : ''} !`, 'success');
                this.closeBulkPromoModal();
                // Reload collections to show updated prices
                await this.loadCollections();
            } else {
                throw new Error(result.error || 'Erreur lors du retrait des promotions');
            }
        } catch (error) {
            console.error('Error removing bulk promo:', error);
            this.showNotification('Erreur: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    renderCollectionGallery() {
        const gallery = document.getElementById('collectionImagesGallery');
        const dropzone = document.getElementById('collectionImageDropzone');
        if (!gallery) return;

        if (!this.collectionImages) {
            gallery.innerHTML = '';
            if (dropzone) dropzone.style.display = '';
            return;
        }

        // Image présente : cacher la dropzone, afficher la vignette style produit
        if (dropzone) dropzone.style.display = 'none';

        gallery.innerHTML = `
            <div class="product-image-thumb" style="position:relative;display:inline-flex;flex-direction:column;width:120px;">
                <div style="position:relative;">
                    <img src="${this.collectionImages.src}" alt="Image de la collection"
                         style="width:120px;height:120px;object-fit:cover;border-radius:10px;border:2px solid #5B1013;display:block;">
                    <span style="position:absolute;top:6px;left:6px;background:#5B1013;color:white;font-size:0.65rem;padding:3px 7px;border-radius:12px;font-weight:700;">Couverture</span>
                </div>
                <div style="display:flex;gap:4px;margin-top:6px;">
                    <button type="button"
                            onclick="window.collectionsManager.removeCollectionImage()"
                            style="flex:1;background:#fef2f2;color:#ef4444;border:1px solid #fecaca;border-radius:6px;padding:5px;cursor:pointer;font-size:0.8rem;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    removeCollectionImage() {
        this.collectionImages = null;
        this.renderCollectionGallery();
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `admin-notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ===================================
    // REORDER COLLECTIONS
    // ===================================

    openCollectionsReorderPanel() {
        const panel = document.getElementById('collectionsReorderPanel');
        const list  = document.getElementById('collectionsReorderList');
        if (!panel || !list) return;

        // Build ordered list
        let ordered = [...this.collections];
        if (this.collectionsOrder && this.collectionsOrder.length > 0) {
            const map = {};
            this.collectionsOrder.forEach((id, i) => { map[String(id)] = i; });
            ordered.sort((a, b) => {
                const pa = map[String(a.id)] !== undefined ? map[String(a.id)] : 9999;
                const pb = map[String(b.id)] !== undefined ? map[String(b.id)] : 9999;
                return pa - pb;
            });
        }

        list.innerHTML = ordered.map((col, i) => {
            const img = col.image?.src || '';
            return `<div class="col-reorder-item" data-id="${col.id}" draggable="true">
                <span class="col-reorder-handle"><i class="fas fa-grip-vertical"></i></span>
                <span class="col-reorder-num">${i + 1}</span>
                ${img ? `<img src="${img}" class="col-reorder-img">` : '<div class="col-reorder-img no-img"></div>'}
                <span class="col-reorder-title">${col.title}</span>
            </div>`;
        }).join('');

        this._origColOrder = ordered.map(c => String(c.id));
        this.initColReorderDrag(list);

        panel.style.display = 'flex';
    }

    initColReorderDrag(list) {
        let dragged = null;
        list.querySelectorAll('.col-reorder-item').forEach(item => {
            item.addEventListener('dragstart', () => {
                dragged = item;
                setTimeout(() => item.classList.add('col-reorder-dragging'), 0);
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('col-reorder-dragging');
                dragged = null;
                this.updateColReorderNums(list);
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragged || dragged === item) return;
                const mid = item.getBoundingClientRect().top + item.offsetHeight / 2;
                list.insertBefore(dragged, e.clientY < mid ? item : item.nextSibling);
            });
        });
    }

    updateColReorderNums(list) {
        list.querySelectorAll('.col-reorder-item').forEach((item, i) => {
            item.querySelector('.col-reorder-num').textContent = i + 1;
        });
    }

    cancelCollectionsReorder() {
        document.getElementById('collectionsReorderPanel').style.display = 'none';
    }

    async saveCollectionsOrder() {
        const list = document.getElementById('collectionsReorderList');
        if (!list) return;
        const newOrder = Array.from(list.querySelectorAll('.col-reorder-item')).map(el => el.dataset.id);
        try {
            const res = await fetch(`${this.apiUrl}/boutique-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collectionsOrder: newOrder })
            });
            if (!res.ok) throw new Error();
            this.collectionsOrder = newOrder;
            document.getElementById('collectionsReorderPanel').style.display = 'none';
            this.showNotification('Ordre des collections sauvegardé !', 'success');
        } catch {
            this.showNotification('Erreur lors de la sauvegarde', 'error');
        }
    }
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }

    .collections-loading {
        text-align: center;
        padding: 3rem;
        color: #6b7280;
        grid-column: 1 / -1;
    }

    .collections-loading i {
        font-size: 2rem;
        margin-bottom: 1rem;
        animation: spin 1s linear infinite;
        display: block;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* Collection type badge */
    .collection-type-badge {
        font-size: 0.7rem;
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-weight: 600;
        text-transform: uppercase;
    }
    .collection-type-badge.custom {
        background: #dbeafe;
        color: #2563eb;
    }
    .collection-type-badge.smart {
        background: #fef3c7;
        color: #d97706;
    }

    /* Products inside collection */
    .collection-products-list {
        margin-top: 1rem;
        border-top: 1px solid #e5e7eb;
        padding-top: 1rem;
    }
    .collection-products-header {
        margin-bottom: 0.75rem;
        font-size: 0.9rem;
        color: #374151;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .btn-collection-promo {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: #fff;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
    }
    .btn-collection-promo:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
    }
    .btn-collection-promo i {
        font-size: 0.9rem;
    }
    .collection-products-grid {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 300px;
        overflow-y: auto;
    }
    .collection-product-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem;
        background: #f9fafb;
        border-radius: 8px;
        border: 1px solid #f3f4f6;
    }
    .collection-product-item:hover {
        background: #f3f4f6;
    }
    .collection-product-thumb {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
    }
    .collection-product-thumb.no-image {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #e5e7eb;
        color: #9ca3af;
        font-size: 0.8rem;
    }
    .collection-product-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex: 1;
        min-width: 0;
    }
    .collection-product-name {
        font-size: 0.85rem;
        color: #374151;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
    }
    .collection-product-price {
        font-size: 0.85rem;
        font-weight: 600;
        color: #8B5A3C;
        flex-shrink: 0;
        margin-left: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .collection-product-price .original-price {
        font-size: 0.75rem;
        color: #9ca3af;
        text-decoration: line-through;
        font-weight: 400;
    }
    .collection-product-price .promo-price {
        color: #dc2626;
        font-weight: 700;
    }
    .collection-product-price .promo-icon {
        color: #dc2626;
        font-size: 0.7rem;
        animation: pulse 1.5s infinite;
    }
    .collection-product-item.has-promo {
        border-color: rgba(220, 38, 38, 0.3);
        background: linear-gradient(135deg, rgba(254, 242, 242, 0.5) 0%, #f9fafb 100%);
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }
    .no-products-msg {
        color: #9ca3af;
        font-size: 0.85rem;
        font-style: italic;
        padding: 0.5rem;
    }
`;
document.head.appendChild(style);

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.collectionsManager = new ShopifyCollectionsManager();
    });
} else {
    window.collectionsManager = new ShopifyCollectionsManager();
}
