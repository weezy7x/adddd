// ===================================
// My Flowers - Backend Server
// Shopify Admin API Proxy + Collections
// ===================================

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Automatisation des tokens (doit être importé tôt)
const { setupTokenAutomation } = require('./token-automation');

const app = express();
const PORT = process.env.PORT || 3000;

const DEBUG_LOGS = process.env.DEBUG_LOGS === '1';
const debugLog = (...args) => { if (DEBUG_LOGS) console.log(...args); };


// Config file for boutique-visible collections
const CONFIG_FILE = path.join(__dirname, 'boutique-config.json');
const RESPONSE_CACHE_TTL_MS = Math.max(300, parseInt(process.env.RESPONSE_CACHE_TTL_MS || '2500', 10) || 2500);
const responseCache = new Map();


function loadBoutiqueConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (!config.featuredCollections) config.featuredCollections = [];
            if (!config.hiddenProducts) config.hiddenProducts = [];
            if (!config.featuredProducts) config.featuredProducts = [];
            return config;
        }
    } catch (e) { console.error('Error reading config:', e); }
    return { hiddenCollections: [], featuredCollections: [], hiddenProducts: [], featuredProducts: [] };
}

function saveBoutiqueConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function getCachedResponse(key) {
    const cached = responseCache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        responseCache.delete(key);
        return null;
    }
    return cached.value;
}

function setCachedResponse(key, value, ttlMs = RESPONSE_CACHE_TTL_MS) {
    responseCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}

function invalidateResponseCache(prefixes) {
    const list = Array.isArray(prefixes) ? prefixes : [prefixes];
    for (const key of responseCache.keys()) {
        if (list.some(prefix => key.startsWith(prefix))) {
            responseCache.delete(key);
        }
    }
}

function invalidateCatalogCaches() {
    invalidateResponseCache([
        'GET:/api/products',
        'GET:/api/collections',
        'GET:/api/collects',
        'GET:/api/boutique-config'
    ]);
}

app.use('/api', (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
        if (/^\/(products|collections|collects|inventory|boutique-config)\b/.test(req.path)) {
            invalidateCatalogCaches();
        }
    }
    next();
});

// Shopify Configuration
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'myflowers-secours.myshopify.com';
const STATIC_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const API_VERSION = '2026-01';

const canUseStaticToken = !!STATIC_ADMIN_API_TOKEN;
const canUseClientCredentials = !!SHOPIFY_CLIENT_ID && !!SHOPIFY_CLIENT_SECRET;

debugLog('✅ Configuration Shopify:');
debugLog(`   Store: ${SHOPIFY_STORE}`);
debugLog(`   API Version: ${API_VERSION}`);
debugLog(`   Static Token: ${canUseStaticToken ? `${STATIC_ADMIN_API_TOKEN.substring(0, 10)}...` : 'not set'}`);
debugLog(`   Client Credentials: ${canUseClientCredentials ? 'configured' : 'not set'}`);

if (!canUseStaticToken && !canUseClientCredentials) {
    console.error('❌ ERREUR: Aucun mode d’auth Shopify configuré.');
    console.error('📋 Configurez un des deux modes dans .env:');
    console.error('   1) SHOPIFY_ADMIN_TOKEN=shpat_...');
    console.error('   2) SHOPIFY_CLIENT_ID=... + SHOPIFY_CLIENT_SECRET=...');
    process.exit(1);
}

// Helper: Global pacing queue for Shopify REST requests (reduces 429 bursts)
let shopifyRestQueue = Promise.resolve();
let lastShopifyRestAt = 0;
const SHOPIFY_MIN_INTERVAL_MS = Math.max(80, parseInt(process.env.SHOPIFY_MIN_INTERVAL_MS || '220', 10) || 220);

function enqueueShopifyRest(task) {
    const run = async () => {
        const now = Date.now();
        const waitMs = Math.max(0, SHOPIFY_MIN_INTERVAL_MS - (now - lastShopifyRestAt));
        if (waitMs > 0) {
            await new Promise(res => setTimeout(res, waitMs));
        }
        lastShopifyRestAt = Date.now();
        return task();
    };

    const next = shopifyRestQueue.then(run, run);
    shopifyRestQueue = next.catch(() => {});
    return next;
}

let cachedPrimaryLocationId = null;
let cachedPrimaryLocationFetchedAt = 0;
const PRIMARY_LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
let oauthTokenValue = null;
let oauthTokenExpiresAt = 0;
let oauthTokenFetchPromise = null;

function isTokenExpiringSoon() {
    if (!oauthTokenValue || !oauthTokenExpiresAt) return true;
    return Date.now() >= (oauthTokenExpiresAt - TOKEN_REFRESH_SKEW_MS);
}

async function fetchOauthAccessToken() {
    const url = `https://${SHOPIFY_STORE}/admin/oauth/access_token`;
    const formBody = `grant_type=client_credentials&client_id=${encodeURIComponent(SHOPIFY_CLIENT_ID)}&client_secret=${encodeURIComponent(SHOPIFY_CLIENT_SECRET)}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || !payload.access_token) {
        const message = payload.error_description || payload.error || `OAuth token request failed (HTTP ${response.status})`;
        throw new Error(message);
    }

    const ttlSec = Number(payload.expires_in) || Math.floor(DEFAULT_TOKEN_TTL_MS / 1000);
    oauthTokenValue = payload.access_token;
    oauthTokenExpiresAt = Date.now() + (ttlSec * 1000);
    debugLog(`✅ OAuth access token refreshed (ttl=${ttlSec}s)`);
    return oauthTokenValue;
}

async function getShopifyAccessToken(forceRefresh = false) {
    if (canUseStaticToken) return STATIC_ADMIN_API_TOKEN;
    if (!canUseClientCredentials) throw new Error('No Shopify credential mode available');

    if (!forceRefresh && !isTokenExpiringSoon()) {
        return oauthTokenValue;
    }

    if (!oauthTokenFetchPromise) {
        oauthTokenFetchPromise = fetchOauthAccessToken()
            .finally(() => { oauthTokenFetchPromise = null; });
    }
    return oauthTokenFetchPromise;
}

async function getPrimaryLocationId(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedPrimaryLocationId && (now - cachedPrimaryLocationFetchedAt) < PRIMARY_LOCATION_CACHE_TTL_MS) {
        return cachedPrimaryLocationId;
    }

    const locData = await shopifyAdminRequest('/locations.json');
    const locations = Array.isArray(locData.locations) ? locData.locations : [];
    const firstLocationId = locations.length > 0 ? locations[0].id : null;
    cachedPrimaryLocationId = firstLocationId || null;
    cachedPrimaryLocationFetchedAt = now;
    return cachedPrimaryLocationId;
}

// Helper: Make Shopify Admin API Request (REST) with rate limit handling
async function shopifyAdminRequest(endpoint, method = 'GET', body = null, retryCount = 0, authRetryDone = false) {
    const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}${endpoint}`;
    const accessToken = await getShopifyAccessToken(false);
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await enqueueShopifyRest(() => fetch(url, options));
        let data = {};
        try {
            data = await response.json();
        } catch (_) {
            data = {};
        }

        if (response.status === 401 && canUseClientCredentials && !authRetryDone) {
            await getShopifyAccessToken(true);
            return shopifyAdminRequest(endpoint, method, body, retryCount, true);
        }

        if (response.status === 429) {
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfterMs = retryAfterHeader ? Math.max(0, Math.round(parseFloat(retryAfterHeader) * 1000)) : 0;
            const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
            const delay = Math.max(retryAfterMs, backoffMs);
            console.warn(`?? Shopify rate limit hit. Retrying in ${delay}ms (attempt ${retryCount + 1})`);
            await new Promise(res => setTimeout(res, delay));
            if (retryCount < 5) {
                return shopifyAdminRequest(endpoint, method, body, retryCount + 1, authRetryDone);
            }
            throw new Error('Shopify API rate limit exceeded after multiple retries.');
        }

        if (!response.ok) {
            console.error('? Shopify API Error:');
            console.error('   URL:', url);
            console.error('   Status:', response.status);
            console.error('   Response:', JSON.stringify(data, null, 2));
            throw new Error(JSON.stringify(data));
        }

        return data;
    } catch (error) {
        console.error('? Shopify API Request Failed:', error.message);
        throw error;
    }
}

// Helper: Make Shopify Admin GraphQL Request
async function shopifyGraphQLRequest(query, variables = {}, authRetryDone = false) {
    const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`;
    const accessToken = await getShopifyAccessToken(false);

    const response = await enqueueShopifyRest(() => fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify({ query, variables })
    }));

    if (response.status === 401 && canUseClientCredentials && !authRetryDone) {
        await getShopifyAccessToken(true);
        return shopifyGraphQLRequest(query, variables, true);
    }

    const data = await response.json();

    if (data.errors) {
        console.error('❌ GraphQL Errors:', JSON.stringify(data.errors, null, 2));
        throw new Error(data.errors.map(e => e.message).join(', '));
    }

    return data;
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function getPath(obj, path, fallback) {
    if (obj == null) return fallback;
    const segments = Array.isArray(path) ? path : String(path).split('.');
    let current = obj;
    for (const segment of segments) {
        if (current == null) return fallback;
        current = current[segment];
    }
    return current == null ? fallback : current;
}

function guessColorHex(label) {
    const key = normalizeText(label);
    const map = {
        'blanc': '#FFFFFF',
        'ivoire': '#FFFFF0',
        'creme': '#FFFDD0',
        'beige': '#E8D8B8',
        'beige clair': '#F5E6D3',
        'marron': '#8B4513',
        'chocolat': '#7B3F00',
        'champagne': '#F7E7CE',
        'corail': '#FF7F50',
        'saumon': '#FA8072',
        'nude': '#E4B69D',
        'gris': '#808080',
        'gris clair': '#D3D3D3',
        'noir': '#000000'
    };
    return map[key] || '#7B3F00';
}

async function getProductOptionsGraph(productId) {
    const productGid = `gid://shopify/Product/${productId}`;
    const query = `
        query getProductOptions($id: ID!) {
            product(id: $id) {
                options {
                    id
                    name
                    linkedMetafield {
                        namespace
                        key
                    }
                    optionValues {
                        id
                        name
                        linkedMetafieldValue
                    }
                }
            }
        }
    `;
    const resp = await shopifyGraphQLRequest(query, { id: productGid });
    const options = getPath(resp, 'data.product.options');
    return Array.isArray(options) ? options : [];
}

async function ensureColorPatternMetaobject(label) {
    const listQuery = `
        query listColorPatterns($first: Int!) {
            metaobjects(type: "shopify--color-pattern", first: $first) {
                edges {
                    node {
                        id
                        displayName
                        fields {
                            key
                            value
                        }
                    }
                }
            }
        }
    `;
    const listResp = await shopifyGraphQLRequest(listQuery, { first: 250 });
    const nodes = (getPath(listResp, 'data.metaobjects.edges', []) || []).map(e => e.node).filter(Boolean);

    const wanted = normalizeText(label);
    const existing = nodes.find(n => normalizeText(n.displayName) === wanted);
    if (getPath(existing, 'id')) return existing.id;

    const fallback = nodes[0] || null;
    const fallbackFields = Array.isArray(getPath(fallback, 'fields')) ? fallback.fields : [];
    const fallbackColorTaxonomy = getPath(fallbackFields.find(f => f.key === 'color_taxonomy_reference'), 'value', '["gid://shopify/TaxonomyValue/7"]');
    const fallbackPatternTaxonomy = getPath(fallbackFields.find(f => f.key === 'pattern_taxonomy_reference'), 'value', 'gid://shopify/TaxonomyValue/2874');

    const createMutation = `
        mutation createColorPattern($metaobject: MetaobjectCreateInput!) {
            metaobjectCreate(metaobject: $metaobject) {
                metaobject {
                    id
                    displayName
                }
                userErrors {
                    field
                    message
                    code
                }
            }
        }
    `;
    const createResp = await shopifyGraphQLRequest(createMutation, {
        metaobject: {
            type: 'shopify--color-pattern',
            fields: [
                { key: 'label', value: String(label) },
                { key: 'color', value: guessColorHex(label) },
                { key: 'color_taxonomy_reference', value: String(fallbackColorTaxonomy) },
                { key: 'pattern_taxonomy_reference', value: String(fallbackPatternTaxonomy) }
            ]
        }
    });

    const errs = getPath(createResp, 'data.metaobjectCreate.userErrors', []) || [];
    if (errs.length > 0) {
        throw new Error(errs.map(e => e.message).join(' | '));
    }

    const createdId = getPath(createResp, 'data.metaobjectCreate.metaobject.id');
    if (!createdId) {
        throw new Error(`Unable to create color metaobject for "${label}"`);
    }
    return createdId;
}

async function ensureLinkedOptionValue(productId, optionId, linkedMetafieldValue) {
    const productGid = `gid://shopify/Product/${productId}`;
    const mutation = `
        mutation addLinkedOptionValue($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!]) {
            productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd) {
                userErrors {
                    field
                    message
                    code
                }
            }
        }
    `;
    const resp = await shopifyGraphQLRequest(mutation, {
        productId: productGid,
        option: { id: optionId },
        optionValuesToAdd: [{ linkedMetafieldValue }]
    });

    const errs = getPath(resp, 'data.productOptionUpdate.userErrors', []) || [];
    if (errs.length > 0) {
        const message = errs.map(e => e.message).join(' | ');
        // Already-exists style errors are non-blocking for our purpose.
        const isAlready = message.toLowerCase().includes('already');
        if (!isAlready) {
            throw new Error(message);
        }
    }
}

async function deleteAllProductOptionsGraph(productId) {
    const productGid = `gid://shopify/Product/${productId}`;
    const options = await getProductOptionsGraph(productId);
    const optionIds = (Array.isArray(options) ? options : [])
        .map(o => getPath(o, 'id'))
        .filter(Boolean);

    if (optionIds.length === 0) {
        return { deleted: 0 };
    }

    const mutation = `
        mutation deleteProductOptions($productId: ID!, $options: [ID!]!, $strategy: ProductOptionDeleteStrategy) {
            productOptionsDelete(productId: $productId, options: $options, strategy: $strategy) {
                deletedOptionsIds
                userErrors {
                    field
                    message
                    code
                }
            }
        }
    `;

    const resp = await shopifyGraphQLRequest(mutation, {
        productId: productGid,
        options: optionIds,
        strategy: 'POSITION'
    });

    const errs = getPath(resp, 'data.productOptionsDelete.userErrors', []) || [];
    if (errs.length > 0) {
        throw new Error(errs.map(e => e.message).join(' | '));
    }

    const deletedIds = getPath(resp, 'data.productOptionsDelete.deletedOptionsIds', []) || [];
    return { deleted: deletedIds.length };
}

async function createVariantByOptionValueIds(productId, selections, price) {
    const productGid = `gid://shopify/Product/${productId}`;
    let options = await getProductOptionsGraph(productId);
    const optionValuesInput = [];

    for (const selection of selections) {
        const optionName = String(getPath(selection, 'optionName', '') || '').trim();
        const valueName = String(getPath(selection, 'value', '') || '').trim();
        if (!optionName || !valueName) {
            throw new Error('Invalid option selection for GraphQL variant create');
        }

        let option = options.find(o => normalizeText(getPath(o, 'name')) === normalizeText(optionName));
        if (!option) {
            throw new Error(`Option "${optionName}" not found on product`);
        }

        const isLinked = !!option.linkedMetafield;
        let optionValues = Array.isArray(option.optionValues) ? option.optionValues : [];
        let existing = optionValues.find(v => normalizeText(getPath(v, 'name')) === normalizeText(valueName));

        if (isLinked) {
            if (!getPath(existing, 'id')) {
                const isColorPattern = getPath(option, 'linkedMetafield.namespace') === 'shopify' && getPath(option, 'linkedMetafield.key') === 'color-pattern';
                if (!isColorPattern) {
                    throw new Error(`Option value "${valueName}" not found for option "${optionName}"`);
                }

                const linkedValue = await ensureColorPatternMetaobject(valueName);
                await ensureLinkedOptionValue(productId, option.id, linkedValue);

                // Refresh product options so we can use the concrete option value ID.
                options = await getProductOptionsGraph(productId);
                option = options.find(o => normalizeText(getPath(o, 'name')) === normalizeText(optionName));
                optionValues = Array.isArray(getPath(option, 'optionValues')) ? option.optionValues : [];
                existing = optionValues.find(v => normalizeText(getPath(v, 'name')) === normalizeText(valueName));
            }

            if (!getPath(existing, 'id')) {
                throw new Error(`Option value "${valueName}" not found for option "${optionName}"`);
            }

            optionValuesInput.push({
                id: existing.id,
                optionName
            });
        } else {
            optionValuesInput.push({
                optionName,
                name: valueName
            });
        }
    }

    const mutation = `
        mutation createVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
                productVariants {
                    id
                }
                userErrors {
                    field
                    message
                    code
                }
            }
        }
    `;

    const createResp = await shopifyGraphQLRequest(mutation, {
        productId: productGid,
        variants: [{
            price: String(price || '0.00'),
            optionValues: optionValuesInput
        }]
    });

    const userErrors = getPath(createResp, 'data.productVariantsBulkCreate.userErrors', []) || [];
    if (userErrors.length > 0) {
        throw new Error(userErrors.map(e => e.message).join(' | '));
    }

    const created = getPath(createResp, 'data.productVariantsBulkCreate.productVariants', []) || [];
    return created.length > 0;
}

// Publish a resource (collection/product) to all active sales channels
async function publishToAllChannels(resourceGid) {
    try {
        // First, get all active publications (sales channels)
        const pubQuery = `
            query {
                publications(first: 20) {
                    edges {
                        node {
                            id
                            name
                        }
                    }
                }
            }
        `;
        
        const pubResult = await shopifyGraphQLRequest(pubQuery);
        const publications = pubResult.data.publications.edges.map(e => e.node);
        
        if (publications.length === 0) {
            debugLog('⚠️  No publications/sales channels found');
            return;
        }
        
        debugLog(`📢 Publishing to ${publications.length} channel(s): ${publications.map(p => p.name).join(', ')}`);
        
        // Publish to each channel
        for (const pub of publications) {
            const mutation = `
                mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
                    publishablePublish(id: $id, input: $input) {
                        publishable {
                            availablePublicationsCount {
                                count
                            }
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }
            `;
            
            try {
                const result = await shopifyGraphQLRequest(mutation, {
                    id: resourceGid,
                    input: [{ publicationId: pub.id }]
                });
                
                const errors = (result.data && result.data.publishablePublish && result.data.publishablePublish.userErrors) || [];
                if (errors.length > 0) {
                    console.warn(`⚠️  Publish to "${pub.name}": ${errors.map(e => e.message).join(', ')}`);
                } else {
                    debugLog(`✅ Published to "${pub.name}"`);
                }
            } catch (e) {
                console.warn(`⚠️  Could not publish to "${pub.name}": ${e.message}`);
            }
        }
    } catch (error) {
        console.error('❌ Error publishing to channels:', error.message);
    }
}

// ===================================
// ROUTES - COLLECTIONS (CUSTOM/SMART)
// ===================================

// Helper: Fetch all collections with products using GraphQL (much faster - single request)
async function fetchCollectionsWithProductsGraphQL(limit = 50) {
    const query = `
        query getCollections($first: Int!) {
            collections(first: $first) {
                edges {
                    node {
                        id
                        title
                        handle
                        descriptionHtml
                        image {
                            url
                        }
                        productsCount {
                            count
                        }
                        ruleSet {
                            rules {
                                column
                            }
                        }
                        products(first: 250) {
                            edges {
                                node {
                                    id
                                    title
                                    handle
                                    status
                                    images(first: 5) {
                                        edges {
                                            node {
                                                id
                                                url
                                            }
                                        }
                                    }
                                    variants(first: 10) {
                                        edges {
                                            node {
                                                id
                                                title
                                                price
                                                compareAtPrice
                                                inventoryQuantity
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    const result = await shopifyGraphQLRequest(query, { first: Math.min(limit, 250) });
    const edges = result?.data?.collections?.edges || [];

    return edges.map(edge => {
        const node = edge.node;
        // Extract numeric ID from GID (gid://shopify/Collection/123456 -> 123456)
        const numericId = node.id.split('/').pop();
        
        // Determine collection type based on ruleSet presence
        const isSmartCollection = node.ruleSet && node.ruleSet.rules && node.ruleSet.rules.length > 0;

        // Transform products to REST-like format
        const products = (node.products?.edges || []).map(pEdge => {
            const pNode = pEdge.node;
            const productId = pNode.id.split('/').pop();
            
            return {
                id: parseInt(productId),
                title: pNode.title,
                handle: pNode.handle,
                status: pNode.status?.toLowerCase() || 'active',
                images: (pNode.images?.edges || []).map(iEdge => ({
                    id: parseInt(iEdge.node.id.split('/').pop()),
                    src: iEdge.node.url
                })),
                variants: (pNode.variants?.edges || []).map(vEdge => {
                    const vNode = vEdge.node;
                    return {
                        id: parseInt(vNode.id.split('/').pop()),
                        title: vNode.title,
                        price: vNode.price,
                        compare_at_price: vNode.compareAtPrice,
                        inventory_quantity: vNode.inventoryQuantity
                    };
                })
            };
        });

        return {
            id: parseInt(numericId),
            title: node.title,
            handle: node.handle,
            body_html: node.descriptionHtml,
            image: node.image ? { src: node.image.url } : null,
            products_count: node.productsCount?.count || products.length,
            products: products,
            collection_type: isSmartCollection ? 'smart' : 'custom'
        };
    });
}

// Get ALL collections (custom + smart merged) - Using GraphQL for efficiency
app.get('/api/collections', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const cacheKey = `GET:/api/collections?limit=${limit}`;
        const cached = getCachedResponse(cacheKey);
        if (cached) return res.json(cached);
        
        // Use GraphQL - single request to get all collections with products and variants
        const collections = await fetchCollectionsWithProductsGraphQL(parseInt(limit));
        
        const payload = { collections };
        setCachedResponse(cacheKey, payload);
        res.json(payload);
    } catch (error) {
        console.error('Error fetching collections via GraphQL:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get single custom collection
app.get('/api/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await shopifyAdminRequest(`/custom_collections/${id}.json`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create custom collection
app.post('/api/collections', async (req, res) => {
    try {
        const collectionData = req.body;
        
        // Ensure collection is published
        if (collectionData.custom_collection) {
            collectionData.custom_collection.published = true;
        }
        
        const data = await shopifyAdminRequest('/custom_collections.json', 'POST', collectionData);
        debugLog('✅ Collection created:', data.custom_collection && data.custom_collection.title);
        
        // Publish to ALL sales channels (Online Store, Storefront API, etc.)
        if (data.custom_collection && data.custom_collection.id) {
            const gid = `gid://shopify/Collection/${data.custom_collection.id}`;
            debugLog('📢 Publishing collection to all sales channels...');
            await publishToAllChannels(gid);
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update custom collection
app.put('/api/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const collectionData = req.body;
        
        const data = await shopifyAdminRequest(`/custom_collections/${id}.json`, 'PUT', collectionData);
        debugLog('✅ Collection updated:', data.custom_collection && data.custom_collection.title);
        
        // Ensure it stays published to all sales channels
        if (data.custom_collection && data.custom_collection.id) {
            const gid = `gid://shopify/Collection/${data.custom_collection.id}`;
            await publishToAllChannels(gid);
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete custom collection
app.delete('/api/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await shopifyAdminRequest(`/custom_collections/${id}.json`, 'DELETE');
        debugLog('✅ Collection deleted:', id);
        res.json({ success: true, message: 'Collection deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Publish a collection to all sales channels (for existing collections that were excluded)
app.post('/api/collections/:id/publish', async (req, res) => {
    try {
        const { id } = req.params;
        const gid = `gid://shopify/Collection/${id}`;
        await publishToAllChannels(gid);
        res.json({ success: true, message: `Collection ${id} published to all channels` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Apply bulk promotion to all products in a collection
app.post('/api/collections/:id/bulk-promo', async (req, res) => {
    try {
        const { id } = req.params;
        const { percentage } = req.body;
        
        if (!percentage || percentage < 1 || percentage > 99) {
            return res.status(400).json({ error: 'Le pourcentage doit être entre 1 et 99' });
        }
        
        // Get all products in the collection (try to get variants from this call first)
        const productsData = await shopifyAdminRequest(`/collections/${id}/products.json?limit=250`);
        let products = productsData.products || [];

        if (products.length === 0) {
            return res.status(404).json({ error: 'Aucun produit trouvé dans cette collection' });
        }

        let updatedCount = 0;
        const errors = [];

        // Update each product's price with promotion
        for (const prod of products) {
            try {
                let product = prod;

                // If variants are missing, fetch full product data
                if (!product.variants || product.variants.length === 0) {
                    try {
                        const full = await shopifyAdminRequest(`/products/${product.id}.json`);
                        if (full && full.product) product = full.product;
                    } catch (e) {
                        // ignore and continue with what we have
                    }
                }

                const variant = product.variants?.[0];
                if (!variant) continue;

                // Determine base price: prefer compare_at_price when it's greater than current price
                const currentPrice = parseFloat(variant.price || 0);
                const compareAt = parseFloat(variant.compare_at_price || 0);
                const basePrice = (compareAt > currentPrice) ? compareAt : currentPrice;

                const newPrice = (basePrice * (1 - percentage / 100)).toFixed(2);
                const compareAtPrice = basePrice.toFixed(2);

                // Update the variant using the same endpoint as single-product updates
                await shopifyAdminRequest(
                    `/products/${product.id}/variants/${variant.id}.json`,
                    'PUT',
                    {
                        variant: {
                            id: variant.id,
                            price: newPrice,
                            compare_at_price: compareAtPrice
                        }
                    }
                );

                updatedCount++;

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 150));

            } catch (productError) {
                console.error(`Error updating product ${prod.id}:`, productError.message || productError);
                errors.push({ productId: prod.id, error: (productError && productError.message) ? productError.message : String(productError) });
            }
        }
        
        // Clear cache for collections and products
        invalidateResponseCache(['collections', 'products']);
        
        res.json({ 
            success: true, 
            updatedCount, 
            totalProducts: products.length,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Error applying bulk promo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Remove bulk promotion from all products in a collection
app.post('/api/collections/:id/bulk-promo/remove', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get all products in the collection
        const productsData = await shopifyAdminRequest(`/collections/${id}/products.json?limit=250`);
        let products = productsData.products || [];

        if (products.length === 0) {
            return res.status(404).json({ error: 'Aucun produit trouvé dans cette collection' });
        }

        let updatedCount = 0;
        const errors = [];

        // Update each product's price - restore original from compare_at_price
        for (const prod of products) {
            try {
                let product = prod;

                // If variants are missing, fetch full product
                if (!product.variants || product.variants.length === 0) {
                    try {
                        const full = await shopifyAdminRequest(`/products/${product.id}.json`);
                        if (full && full.product) product = full.product;
                    } catch (e) {
                        // ignore
                    }
                }

                const variant = product.variants?.[0];
                if (!variant) continue;

                // Only process if there's a compare_at_price (meaning it's on promo)
                if (!variant.compare_at_price) continue;

                const originalPrice = parseFloat(variant.compare_at_price);

                // Update the variant - restore original price and clear compare_at_price
                await shopifyAdminRequest(
                    `/products/${product.id}/variants/${variant.id}.json`,
                    'PUT',
                    {
                        variant: {
                            id: variant.id,
                            price: originalPrice.toFixed(2),
                            compare_at_price: null
                        }
                    }
                );

                updatedCount++;

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 150));

            } catch (productError) {
                console.error(`Error updating product ${prod.id}:`, productError.message || productError);
                errors.push({ productId: prod.id, error: (productError && productError.message) ? productError.message : String(productError) });
            }
        }
        
        // Clear cache for collections and products
        invalidateResponseCache(['collections', 'products']);
        
        res.json({ 
            success: true, 
            updatedCount, 
            totalProducts: products.length,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Error removing bulk promo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get products in a collection
app.get('/api/collections/:id/products', async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50 } = req.query;
        const cacheKey = `GET:/api/collections/${id}/products?limit=${limit}`;
        const cached = getCachedResponse(cacheKey);
        if (cached) return res.json(cached);
        const data = await shopifyAdminRequest(`/collections/${id}/products.json?limit=${limit}`);
        
        // Shopify's collection products endpoint may return products without
        // full variant details (inventory_quantity, price, etc.).
        // Re-fetch full product data using the product IDs so the admin panel
        // gets complete variant/stock/price information.
        if (data.products && data.products.length > 0) {
            const ids = data.products.map(p => p.id).join(',');
            try {
                const fullData = await shopifyAdminRequest(`/products.json?ids=${ids}&limit=${limit}`);
                if (fullData.products && fullData.products.length > 0) {
                    data.products = fullData.products;
                }
            } catch (enrichErr) {
                console.warn('Could not enrich collection products, using original data:', enrichErr.message);
            }
        }
        
        setCachedResponse(cacheKey, data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - PRODUCTS
// ===================================
// Add images to a product
app.post('/api/products/:id/images', async (req, res) => {
    try {
        const { id } = req.params;
        let images = [];
        // Accept both { images: [...] } and direct image object (for compatibility)
        if (Array.isArray(req.body.images)) {
            images = req.body.images;
        } else if (req.body.attachment || req.body.src) {
            images = [req.body];
        } else {
            return res.status(400).json({ error: 'No images provided' });
        }

        // Shopify expects an array of image objects: [{ attachment: base64 }, { src: url }, ...]
        const imagePayloads = images.map(img => {
            if (img.attachment) {
                return { attachment: img.attachment };
            } else if (img.src) {
                return { src: img.src };
            }
            return null;
        }).filter(Boolean);

        if (imagePayloads.length === 0) {
            return res.status(400).json({ error: 'No valid images provided' });
        }

        // Add each image to the product
        const results = [];
        for (const image of imagePayloads) {
            const result = await shopifyAdminRequest(`/products/${id}/images.json`, 'POST', { image });
            results.push(result);
        }
        // If only one image, return the image object directly for frontend compatibility
        if (results.length === 1 && results[0].image) {
            return res.json({ success: true, image: results[0].image });
        }
        res.json({ success: true, images: results });
    } catch (error) {
        console.error('❌ Error uploading images:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete an image from a product
app.delete('/api/products/:productId/images/:imageId', async (req, res) => {
    try {
        const { productId, imageId } = req.params;
        if (!productId || !imageId) {
            return res.status(400).json({ error: 'Product ID and Image ID required' });
        }
        await shopifyAdminRequest(`/products/${productId}/images/${imageId}.json`, 'DELETE');
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error deleting image:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const { limit = 50, page_info, collection_id } = req.query;
        const cacheKey = `GET:${req.originalUrl}`;
        const cached = getCachedResponse(cacheKey);
        if (cached) return res.json(cached);
        let endpoint = `/products.json?limit=${limit}`;
        
        if (page_info) {
            endpoint += `&page_info=${page_info}`;
        }
        
        if (collection_id) {
            endpoint = `/collections/${collection_id}/products.json?limit=${limit}`;
        }
        
        const data = await shopifyAdminRequest(endpoint);
        setCachedResponse(cacheKey, data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `GET:/api/products/${id}`;
        const cached = getCachedResponse(cacheKey);
        if (cached) return res.json(cached);
        const data = await shopifyAdminRequest(`/products/${id}.json`);
        setCachedResponse(cacheKey, data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create product
app.post('/api/products', async (req, res) => {
    try {
        const productData = req.body || {};
        const requestedVariants = Array.isArray(getPath(productData, 'product.variants')) ? productData.product.variants : [];

        if (productData.product) {
            productData.product.published = true;
        }

        let data = await shopifyAdminRequest('/products.json', 'POST', productData);

        if (data.product && data.product.id) {
            const productId = data.product.id;
            const currentVariants = Array.isArray(data.product.variants) ? data.product.variants : [];
            const optionNamesByIndex = (Array.isArray(data.product.options) ? data.product.options : []).map(o => o.name || '');
            const existingKeys = new Set(currentVariants.map(v => [v.option1 || '', v.option2 || '', v.option3 || ''].join('||')));

            if (requestedVariants.length > 1 && existingKeys.size < requestedVariants.length) {
                let linkedOptionNames = new Set();
                try {
                    const graphOptions = await getProductOptionsGraph(productId);
                    linkedOptionNames = new Set(
                        (graphOptions || [])
                            .filter(o => !!getPath(o, 'linkedMetafield'))
                            .map(o => normalizeText(getPath(o, 'name')))
                    );
                } catch (_) {
                    linkedOptionNames = new Set();
                }

                const defaultPrice = getPath(currentVariants[0], 'price', '0.00') || '0.00';
                for (const rv of requestedVariants) {
                    const o1 = String(rv.option1 || '').trim();
                    const o2 = String(rv.option2 || '').trim();
                    const o3 = String(rv.option3 || '').trim();
                    const key = [o1, o2, o3].join('||');
                    if (existingKeys.has(key)) continue;

                    const variantPayload = {
                        price: String(rv.price || defaultPrice || '0.00'),
                        compare_at_price: rv.compare_at_price || null,
                        inventory_management: rv.inventory_management || 'shopify'
                    };
                    if (o1) variantPayload.option1 = o1;
                    if (o2) variantPayload.option2 = o2;
                    if (o3) variantPayload.option3 = o3;

                    const selections = [];
                    if (o1) selections.push({ optionName: optionNamesByIndex[0] || 'Option 1', value: o1 });
                    if (o2) selections.push({ optionName: optionNamesByIndex[1] || 'Option 2', value: o2 });
                    if (o3) selections.push({ optionName: optionNamesByIndex[2] || 'Option 3', value: o3 });

                    const requiresGraph = selections.some(s => linkedOptionNames.has(normalizeText(s.optionName)));

                    let created = false;
                    if (requiresGraph) {
                        try {
                            created = await createVariantByOptionValueIds(productId, selections, variantPayload.price);
                        } catch (e) {
                            console.warn('Graph create failed during product creation fallback:', e.message || e);
                        }
                    }

                    if (!created) {
                        try {
                            await shopifyAdminRequest(`/products/${productId}/variants.json`, 'POST', { variant: variantPayload });
                            created = true;
                        } catch (e) {
                            const msg = e && e.message ? String(e.message) : String(e);
                            if (msg.includes('Cannot set name for an option value linked to a metafield')) {
                                try {
                                    created = await createVariantByOptionValueIds(productId, selections, variantPayload.price);
                                } catch (e2) {
                                    console.warn('Graph fallback failed during product creation fallback:', e2.message || e2);
                                }
                            }
                        }
                    }

                    if (created) {
                        existingKeys.add(key);
                    }
                }

                data = await shopifyAdminRequest(`/products/${productId}.json`);
            }

            const gid = `gid://shopify/Product/${productId}`;
            debugLog('Publishing product to all sales channels...');
            publishToAllChannels(gid).catch((e) => {
                console.warn('Background publish failed for product', productId, '-', e && e.message ? e.message : e);
            });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update product
app.put('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let productData = req.body;
        // Nettoyage et validation des options
        if (productData.product) {
            const cleanProduct = {
                title: productData.product.title,
                body_html: productData.product.body_html,
                status: productData.product.status,
                product_type: productData.product.product_type,
                vendor: productData.product.vendor,
                tags: productData.product.tags
            };
            // Images
            if (productData.product.images) {
                cleanProduct.images = productData.product.images;
            }
            // Options
            if (productData.product.options && Array.isArray(productData.product.options)) {
                cleanProduct.options = productData.product.options.map(opt => ({
                    name: typeof opt.name === 'string' ? opt.name.trim() : '',
                    values: Array.isArray(opt.values) ? opt.values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : []
                })).filter(opt => opt.name && opt.values.length);
            }
            productData.product = cleanProduct;
        }
        // Ne PAS envoyer les variantes - elles causeraient l'erreur de métachamps
        const data = await shopifyAdminRequest(`/products/${id}.json`, 'PUT', productData);
        // Retourne les options mises à jour
        let updatedOptions = [];
        if (data.product && data.product.options) {
            updatedOptions = data.product.options;
        }
        res.json({ ...data, options: updatedOptions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update product price (separate route to avoid metafield issues)
app.put('/api/products/:id/price', async (req, res) => {
    try {
        const { id } = req.params;
        const { price, compare_at_price } = req.body;
        
        // Obtenir le produit d'abord
        const productData = await shopifyAdminRequest(`/products/${id}.json`);
        const product = productData.product;
        
        if (!product || !product.variants || product.variants.length === 0) {
            return res.status(404).json({ error: 'Product or variants not found' });
        }
        
        // Mettre à jour uniquement le prix de la première variante
        const variant = product.variants[0];
        const variantUpdateData = {
            variant: {
                id: variant.id,
                price: price,
                compare_at_price: compare_at_price || null
            }
        };
        
        const result = await shopifyAdminRequest(`/products/${id}/variants/${variant.id}.json`, 'PUT', variantUpdateData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await shopifyAdminRequest(`/products/${id}.json`, 'DELETE');
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a new variant to an existing product
app.post('/api/products/:id/variants', async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};
        const {
            options,
            price,
            compare_at_price,
            inventory_quantity,
            inventory_management,
            ...variantFields
        } = body;

        const cartesian = (arr) => arr.reduce((a, b) => a.flatMap(d => b.map(e => [].concat(d, e))), [[]]);
        let variantsToCreate = [];

        if (Array.isArray(options) && options.length > 0) {
            const optionValues = options.map(opt =>
                (Array.isArray(opt.values) ? opt.values : [])
                    .map(v => String(v).trim())
                    .filter(Boolean)
            );
            if (optionValues.some(vals => vals.length === 0)) {
                return res.status(400).json({ error: 'Each option must have at least one value' });
            }
            const combos = cartesian(optionValues);
            variantsToCreate = combos.map(combo => {
                const v = {
                    price: price || '0.00',
                    compare_at_price: compare_at_price || null,
                    inventory_management: inventory_management || 'shopify'
                };
                combo.forEach((val, idx) => { v[`option${idx + 1}`] = val; });
                return v;
            });
        } else {
            const single = { ...variantFields };
            if (price !== undefined) single.price = String(price);
            if (compare_at_price !== undefined) single.compare_at_price = compare_at_price || null;
            if (!single.inventory_management) single.inventory_management = inventory_management || 'shopify';
            variantsToCreate = [single];
        }

        let graphOptions = [];
        let linkedOptionNames = new Set();
        try {
            graphOptions = await getProductOptionsGraph(id);
            linkedOptionNames = new Set(
                (graphOptions || [])
                    .filter(o => !!getPath(o, 'linkedMetafield'))
                    .map(o => normalizeText(getPath(o, 'name')))
            );
        } catch (_) {
            graphOptions = [];
            linkedOptionNames = new Set();
        }

        const optionNamesByIndex = (Array.isArray(graphOptions) && graphOptions.length > 0)
            ? graphOptions.map(o => o.name || '')
            : (Array.isArray(options) ? options.map(o => o.name || '') : []);

        const createdVariants = [];
        const failedVariants = [];
        const toVariantKey = (o1, o2, o3) => [String(o1 || '').trim(), String(o2 || '').trim(), String(o3 || '').trim()].join('||');
        let existingVariantKeys = new Set();
        try {
            const currentProduct = await shopifyAdminRequest(`/products/${id}.json`);
            const currentVariants = Array.isArray(getPath(currentProduct, 'product.variants')) ? currentProduct.product.variants : [];
            existingVariantKeys = new Set(currentVariants.map(v => toVariantKey(v.option1, v.option2, v.option3)));
        } catch (_) {
            existingVariantKeys = new Set();
        }
        let locationId = null;
        const ensureLocationId = async () => {
            if (locationId) return locationId;
            try {
                const locData = await shopifyAdminRequest('/locations.json');
                locationId = locData.locations && locData.locations[0] && locData.locations[0].id;
            } catch (_) {
                locationId = null;
            }
            return locationId;
        };

        for (const variant of variantsToCreate) {
            const option1 = String(variant.option1 || '').trim();
            const option2 = String(variant.option2 || '').trim();
            const option3 = String(variant.option3 || '').trim();
            const variantKey = toVariantKey(option1, option2, option3);

            if (existingVariantKeys.has(variantKey)) {
                continue;
            }

            const selections = [];
            if (option1) selections.push({ optionName: optionNamesByIndex[0] || 'Option 1', value: option1 });
            if (option2) selections.push({ optionName: optionNamesByIndex[1] || 'Option 2', value: option2 });
            if (option3) selections.push({ optionName: optionNamesByIndex[2] || 'Option 3', value: option3 });

            const requiresGraph = selections.some(s => linkedOptionNames.has(normalizeText(s.optionName)));
            let createdVariant = null;
            let lastCreateError = null;
            let duplicateAlreadyExists = false;

            if (requiresGraph && selections.length > 0) {
                try {
                    const created = await createVariantByOptionValueIds(id, selections, variant.price || price || '0.00');
                    if (created) {
                        const refreshed = await shopifyAdminRequest(`/products/${id}.json`);
                        const all = getPath(refreshed, 'product.variants', []) || [];
                        createdVariant = all.find(v =>
                            String(v.option1 || '').trim() === option1 &&
                            String(v.option2 || '').trim() === option2 &&
                            String(v.option3 || '').trim() === option3
                        ) || null;
                    }
                } catch (e) {
                    lastCreateError = e && e.message ? String(e.message) : String(e);
                    if (/already exists/i.test(lastCreateError)) {
                        duplicateAlreadyExists = true;
                    }
                    console.warn('Graph variant create failed:', e.message || e);
                }
            }

            if (!createdVariant) {
                const restPayload = { ...variant };
                if (!restPayload.price && price !== undefined) restPayload.price = String(price);
                if (restPayload.compare_at_price === undefined && compare_at_price !== undefined) {
                    restPayload.compare_at_price = compare_at_price || null;
                }
                if (!restPayload.inventory_management) restPayload.inventory_management = inventory_management || 'shopify';

                try {
                    const result = await shopifyAdminRequest(`/products/${id}/variants.json`, 'POST', { variant: restPayload });
                    createdVariant = getPath(result, 'variant') || null;
                } catch (e) {
                    const msg = e && e.message ? String(e.message) : String(e);
                    lastCreateError = msg;
                    if (/already exists/i.test(msg)) {
                        duplicateAlreadyExists = true;
                    }
                    if (msg.includes('Cannot set name for an option value linked to a metafield') && selections.length > 0) {
                        try {
                            const created = await createVariantByOptionValueIds(id, selections, variant.price || price || '0.00');
                            if (created) {
                                const refreshed = await shopifyAdminRequest(`/products/${id}.json`);
                                const all = getPath(refreshed, 'product.variants', []) || [];
                                createdVariant = all.find(v =>
                                    String(v.option1 || '').trim() === option1 &&
                                    String(v.option2 || '').trim() === option2 &&
                                    String(v.option3 || '').trim() === option3
                                ) || null;
                            }
                        } catch (e2) {
                            lastCreateError = e2 && e2.message ? String(e2.message) : String(e2);
                            if (/already exists/i.test(lastCreateError)) {
                                duplicateAlreadyExists = true;
                            }
                            console.warn('Graph fallback variant create failed:', e2.message || e2);
                        }
                    } else {
                        console.warn('Could not create variant:', msg);
                    }
                }
            }

            if (createdVariant) {
                createdVariants.push(createdVariant);
                existingVariantKeys.add(variantKey);
                if (inventory_quantity !== undefined && createdVariant.inventory_item_id) {
                    try {
                        const locId = await ensureLocationId();
                        if (locId) {
                            await shopifyAdminRequest('/inventory_levels/set.json', 'POST', {
                                location_id: locId,
                                inventory_item_id: createdVariant.inventory_item_id,
                                available: parseInt(inventory_quantity) || 0
                            });
                        }
                    } catch (e) {
                        console.warn('Could not set variant inventory:', e.message || e);
                    }
                }
            } else if (duplicateAlreadyExists) {
                existingVariantKeys.add(variantKey);
            } else {
                failedVariants.push({
                    option1,
                    option2,
                    option3,
                    error: lastCreateError || 'Unable to create variant'
                });
            }
        }

        if (failedVariants.length > 0) {
            return res.status(422).json({
                error: failedVariants[0].error,
                createdCount: createdVariants.length,
                failedCount: failedVariants.length,
                failed: failedVariants
            });
        }

        res.json({ success: true, variants: createdVariants });
    } catch (error) {
        console.error('Error adding variant:', error.message || error);
        res.status(500).json({ error: error.message || String(error) });
    }
});

// Delete a variant
app.delete('/api/products/:productId/variants/:variantId', async (req, res) => {
    try {
        const { productId, variantId } = req.params;
        await shopifyAdminRequest(`/products/${productId}/variants/${variantId}.json`, 'DELETE');
        debugLog('✅ Variant deleted:', variantId);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error deleting variant:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Publish a product to all sales channels
app.post('/api/products/:id/publish', async (req, res) => {
    try {
        const { id } = req.params;
        const gid = `gid://shopify/Product/${id}`;
        await publishToAllChannels(gid);
        res.json({ success: true, message: `Product ${id} published to all channels` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get product options from Ymq (metafields)
app.get('/api/products/:id/ymq-options', async (req, res) => {
    try {
        const { id } = req.params;
        
        debugLog(`🔍 Fetching Ymq options for product ${id}...`);
        
        // Fetch all metafields for the product
        const metafieldsData = await shopifyAdminRequest(`/products/${id}/metafields.json?limit=250`);
        const metafields = metafieldsData.metafields || [];
        
        debugLog(`📦 Found ${metafields.length} metafields for product ${id}`);
        
        // Also fetch shop-level metafields (for templates)
        debugLog(`🔍 Checking shop-level metafields for Ymq templates...`);
        try {
            const shopMetafieldsData = await shopifyAdminRequest('/metafields.json?limit=250');
            const shopMetafields = shopMetafieldsData.metafields || [];
            debugLog(`📦 Found ${shopMetafields.length} shop-level metafields`);
            
            const ymqShopMetafields = shopMetafields.filter(mf => 
                mf.namespace.toLowerCase().includes('ymq') || 
                mf.key.toLowerCase().includes('ymq') ||
                mf.key.toLowerCase().includes('template')
            );
            
            if (ymqShopMetafields.length > 0) {
                debugLog(`✅ Found ${ymqShopMetafields.length} Ymq shop metafield(s):`);
                ymqShopMetafields.forEach(mf => {
                    const valuePreview = typeof mf.value === 'string' 
                        ? mf.value.substring(0, 100) 
                        : JSON.stringify(mf.value).substring(0, 100);
                    debugLog(`   - ${mf.namespace}.${mf.key}: ${valuePreview}...`);
                });
            }
        } catch (shopError) {
            debugLog(`⚠️  Could not fetch shop metafields:`, shopError.message);
        }
        
        // Log ALL metafields for debugging
        debugLog('📋 ALL METAFIELDS (complete data):');
        metafields.forEach(mf => {
            const valuePreview = typeof mf.value === 'string' 
                ? mf.value.substring(0, 200) 
                : JSON.stringify(mf.value).substring(0, 200);
            debugLog(`   - ${mf.namespace}.${mf.key} (${mf.type}): ${valuePreview}...`);
        });
        
        // Find ALL Ymq-related metafields (cast a wide net)
        const ymqMetafields = metafields.filter(mf => 
            mf.namespace.toLowerCase().includes('ymq') || 
            mf.key.toLowerCase().includes('ymq') ||
            mf.namespace.toLowerCase().includes('option') ||
            mf.key.toLowerCase().includes('option') ||
            mf.namespace.toLowerCase().includes('template') ||
            mf.key.toLowerCase().includes('template') ||
            mf.namespace === 'ymq_option' ||
            mf.namespace === 'globaleo' ||
            mf.namespace === 'app'
        );
        
        if (ymqMetafields.length === 0) {
            debugLog(`⚠️  No Ymq metafields found for product ${id}`);
            return res.json({ 
                hasYmqOptions: false, 
                options: null,
                message: 'No Ymq metafields found for this product',
                allMetafields: metafields.map(mf => ({
                    namespace: mf.namespace,
                    key: mf.key,
                    type: mf.type
                }))
            });
        }
        
        debugLog(`✅ Found ${ymqMetafields.length} Ymq metafield(s):`, ymqMetafields.map(mf => `${mf.namespace}.${mf.key}`).join(', '));
        
        // Try each Ymq metafield until we find one with actual data
        for (const ymqMetafield of ymqMetafields) {
            debugLog(`🔍 Parsing ${ymqMetafield.namespace}.${ymqMetafield.key}...`);
            
            try {
                const value = ymqMetafield.value;
                
                // Parse JSON
                const parsedOptions = typeof value === 'string' ? JSON.parse(value) : value;
                
                // LOG THE FULL RAW DATA
                debugLog(`📦 RAW YMQ DATA from ${ymqMetafield.namespace}.${ymqMetafield.key}:`, JSON.stringify(parsedOptions, null, 2).substring(0, 1000));
                
                // Convert Ymq format to our format
                const convertedOptions = convertYmqToCustomFormat(parsedOptions);
                
                if (convertedOptions && convertedOptions.length > 0) {
                    debugLog(`✅ Successfully parsed and converted ${convertedOptions.length} Ymq option(s) from ${ymqMetafield.namespace}.${ymqMetafield.key}`);
                    return res.json({
                        hasYmqOptions: true,
                        options: convertedOptions
                    });
                } else {
                    debugLog(`⚠️  No valid options found in ${ymqMetafield.namespace}.${ymqMetafield.key}`);
                }
            } catch (parseError) {
                console.error(`❌ Error parsing ${ymqMetafield.namespace}.${ymqMetafield.key}:`, parseError.message);
            }
        }
        
        // If we get here, no metafield had valid options
        debugLog(`⚠️  No valid Ymq options found in product metafields`);
        
        // Try to find template assignment
        debugLog(`🔍 Checking for template assignment...`);
        try {
            const shopMetafieldsData = await shopifyAdminRequest('/metafields.json?limit=250');
            const shopMetafields = shopMetafieldsData.metafields || [];
            
            // List ALL available templates
            debugLog(`📋 Listing all available Ymq templates...`);
            const templateMetafields = shopMetafields.filter(mf => 
                mf.namespace === 'ymq_option' && mf.key.startsWith('ymq_template_options_new_')
            );
            
            debugLog(`   Found ${templateMetafields.length} template(s):`);
            const templateMap = {};
            for (const tmf of templateMetafields) {
                const templateId = tmf.key.replace('ymq_template_options_new_', '');
                const templateData = typeof tmf.value === 'string' ? JSON.parse(tmf.value) : tmf.value;
                
                // Extract template name from the first option
                let templateName = 'Unknown';
                if (templateData.template) {
                    const firstOptionKey = Object.keys(templateData.template)[0];
                    if (firstOptionKey && templateData.template[firstOptionKey]) {
                        templateName = templateData.template[firstOptionKey].label || 'Unknown';
                    }
                }
                
                templateMap[templateId] = { name: templateName, data: templateData };
                debugLog(`   - Template ${templateId}: "${templateName}"`);
            }
            
            // Find template assignment metafield
            const assignMetafield = shopMetafields.find(mf => 
                mf.namespace === 'ymq_option' && mf.key.startsWith('ymq_assign')
            );
            
            if (assignMetafield) {
                const assignments = typeof assignMetafield.value === 'string' 
                    ? JSON.parse(assignMetafield.value) 
                    : assignMetafield.value;
                
                debugLog(`📋 Found template assignments`);
                
                // Find which template is assigned to this product
                let templateId = null;
                
                for (const [templateKey, templateData] of Object.entries(assignments)) {
                    if (templateData.manual && templateData.manual.product) {
                        const assignedProducts = templateData.manual.product;
                        const isAssigned = assignedProducts.some(p => 
                            String(p.id) === String(id)
                        );
                        
                        if (isAssigned) {
                            templateId = templateKey.replace('tem', '');
                            debugLog(`✅ Found template assignment: Template ${templateId} is assigned to product ${id}`);
                            break;
                        }
                    }
                }
                
                if (templateId) {
                    // Use the template from the map we built earlier
                    if (templateMap[templateId]) {
                        debugLog(`✅ Using template ${templateId}: "${templateMap[templateId].name}"`);
                        const templateData = templateMap[templateId].data;
                        
                        if (templateData.template) {
                            debugLog(`🔄 Converting template options...`);
                            const convertedOptions = convertYmqTemplateToCustomFormat(templateData.template, templateId);
                            
                            if (convertedOptions && convertedOptions.length > 0) {
                                debugLog(`✅ Successfully parsed ${convertedOptions.length} option(s) from template ${templateId}`);
                                return res.json({
                                    hasYmqOptions: true,
                                    options: convertedOptions
                                });
                            }
                        } else {
                            debugLog(`⚠️  Template ${templateId} has no template.template data`);
                        }
                    } else {
                        debugLog(`⚠️  Template ${templateId} not found in template map`);
                    }
                }
            }
        } catch (templateError) {
            console.error(`❌ Error checking templates:`, templateError.message);
        }
        
        return res.json({ 
            hasYmqOptions: false, 
            options: null,
            message: 'Ymq metafields found but no valid options could be extracted'
        });
        
    } catch (error) {
        console.error('❌ Error fetching Ymq options:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: Convert Ymq format to our custom format
function convertYmqToCustomFormat(ymqData) {
    if (!ymqData) return null;
    
    try {
        // Log all keys in the Ymq data to understand structure
        debugLog('🔍 Ymq data keys:', Object.keys(ymqData).join(', '));
        
        // Check if there's a template reference
        if (ymqData.template_id || ymqData.template || ymqData.template_name) {
            debugLog('📋 Template reference found:', ymqData.template_id || ymqData.template || ymqData.template_name);
        }
        
        // Ymq stores options in data.ymq1, data.ymq2, etc.
        if (!ymqData.data || typeof ymqData.data !== 'object') {
            debugLog('⚠️  Invalid Ymq data structure - no data object');
            return null;
        }
        
        const dataKeys = Object.keys(ymqData.data).filter(k => k.startsWith('ymq'));
        debugLog(`🔄 Found ${dataKeys.length} Ymq option(s):`, dataKeys.join(', '));
        
        const optionsArray = dataKeys.map(key => ymqData.data[key]);
        
        if (optionsArray.length === 0) {
            debugLog('⚠️  No options found in Ymq data - data object is empty');
            debugLog('💡 This may be using a template. Checking for template references...');
            return null;
        }
        
        debugLog(`🔄 Converting ${optionsArray.length} option(s) from Ymq format...`);
        
        return optionsArray.map((ymqOption, index) => {
            const optionType = String(ymqOption.type || ymqOption.input_type || ymqOption.inputType || '').toLowerCase();
            const optionId = ymqOption.id || `option_${index}`;
            const optionLabel = ymqOption.label || ymqOption.title || ymqOption.name || `Option ${index + 1}`;
            
            debugLog(`   Option ${index + 1} (id: ${optionId}): type="${ymqOption.type}", label="${optionLabel}"`);
            
            const converted = {
                name: ymqOption.name || ymqOption.id || ymqOption.label || `option_${index}`,
                label: optionLabel,
                required: ymqOption.required === "1" || ymqOption.required === 1 || ymqOption.required === true || ymqOption.is_required === "1"
            };
            
            // Extract values from ymqOption.options object (for type 8) or direct keys
            const values = [];
            const optionsSource = ymqOption.options || ymqOption;
            Object.keys(optionsSource).forEach(key => {
                if (key.startsWith(optionId + '_') && typeof optionsSource[key] === 'object') {
                    values.push(optionsSource[key]);
                }
            });
            
            // Determine option type from Ymq field "type"
            if (optionType === '8') {
                // Type 8 = Image selector (product picker with images)
                converted.type = 'image-select';
                converted.values = values.map(v => ({
                    name: v.value || v.label || v.name || v.title,
                    price: parseFloat(v.price || 0),
                    image: v.canvas2 || v.canvas1 || v.image || ''
                }));
            }
            else if (optionType.includes('color') || optionType.includes('colour') || optionType === '0') {
                converted.type = 'color';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    hex: v.color || v.hex || v.colour || v.color_code || '#CCCCCC',
                    price: parseFloat(v.price || 0)
                }));
            } 
            else if (optionType.includes('dropdown') || optionType.includes('select') || optionType === '1') {
                // Type 1 can be dropdown OR single-character text input
                if (ymqOption.max_char === '1' || ymqOption.max_char === 1) {
                    // Single character text input
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = 1;
                    converted.price = parseFloat(ymqOption.price || 0);
                } else if (values.length > 0) {
                    // Dropdown with values
                    converted.type = 'select';
                    converted.values = values.map(v => ({
                        name: v.label || v.name || v.value || v.title,
                        price: parseFloat(v.price || 0),
                        image: v.canvas2 || v.canvas1 || v.image || ''
                    }));
                } else {
                    // Text input
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = parseInt(ymqOption.max_char || ymqOption.maxLength || ymqOption.max_length || 100);
                    converted.price = parseFloat(ymqOption.price || 0);
                }
            }
            else if (optionType === '3' || optionType === '5') {
                // Type 3 & 5 = Dropdown with single selection (like Nombre de Roses)
                converted.type = 'select';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    price: parseFloat(v.price || 0),
                    image: v.canvas2 || v.canvas1 || v.image || ''
                }));
            }
            else if (optionType.includes('checkbox')) {
                converted.type = 'checkbox';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    price: parseFloat(v.price || 0)
                }));
            }
            else if (optionType.includes('text') || optionType.includes('textarea') || optionType === '2') {
                converted.type = 'text';
                converted.placeholder = ymqOption.placeholder || '';
                converted.maxlength = parseInt(ymqOption.max_char || ymqOption.maxLength || ymqOption.max_length || 500);
                converted.price = parseFloat(ymqOption.price || 0);
            }
            else {
                // Fallback: try to infer from values structure
                if (values.length > 0) {
                    debugLog(`   Found ${values.length} value(s) for this option`);
                    converted.type = 'select';
                    converted.values = values.map(v => ({
                        name: v.label || v.name || v.value || v.title || String(v),
                        price: parseFloat(v.price || 0),
                        image: v.canvas2 || v.canvas1 || v.image || ''
                    }));
                } else {
                    // No values, default to text input
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = 100;
                    converted.price = 0;
                }
            }
            
            return converted;
        }).filter(opt => {
            // Filter out options without values (unless it's a text input)
            if (opt.type === 'text') return true;
            if (opt.type === 'image-select' && (!opt.values || opt.values.length === 0)) {
                debugLog(`   ⚠️ Filtered out image-select option "${opt.label}" - no values found`);
                return false;
            }
            return opt.values && opt.values.length > 0;
        });
    } catch (error) {
        console.error('❌ Error converting Ymq format:', error.message);
        console.error('   Stack:', error.stack);
        return null;
    }
}

// Helper: Convert Ymq TEMPLATE format to our custom format
function convertYmqTemplateToCustomFormat(templateData, templateId) {
    if (!templateData || typeof templateData !== 'object') {
        debugLog('⚠️  Invalid template data');
        return null;
    }
    
    try {
        // Template options are stored like: ymq184847tem12, ymq184847tem13, etc.
        const templateKeys = Object.keys(templateData).filter(k => k.includes('tem'));
        debugLog(`   Found ${templateKeys.length} option(s) in template:`, templateKeys.join(', '));
        
        if (templateKeys.length === 0) {
            debugLog('⚠️  No options found in template');
            return null;
        }
        
        const optionsArray = templateKeys.map(key => templateData[key]);
        
        // Use the same conversion logic as regular Ymq options
        return optionsArray.map((ymqOption, index) => {
            const optionType = String(ymqOption.type || ymqOption.input_type || ymqOption.inputType || '').toLowerCase();
            const optionId = ymqOption.id || `option_${index}`;
            const optionLabel = ymqOption.label || ymqOption.title || ymqOption.name || `Option ${index + 1}`;
            
            debugLog(`   Template Option ${index + 1} (id: ${optionId}): type="${ymqOption.type}", label="${optionLabel}"`);
            
            const converted = {
                name: ymqOption.name || ymqOption.id || ymqOption.label || `option_${index}`,
                label: optionLabel,
                required: ymqOption.required === "1" || ymqOption.required === 1 || ymqOption.required === true || ymqOption.is_required === "1"
            };
            
            // Extract values from ymqOption.options object (for type 8) or direct keys
            const values = [];
            const optionsSource = ymqOption.options || ymqOption;
            Object.keys(optionsSource).forEach(key => {
                if (key.startsWith(optionId + '_') && typeof optionsSource[key] === 'object') {
                    values.push(optionsSource[key]);
                }
            });
            
            // Determine option type from Ymq field "type"
            if (optionType === '8') {
                // Type 8 = Image selector (product picker with images)
                converted.type = 'image-select';
                converted.values = values.map(v => ({
                    name: v.value || v.label || v.name || v.title,
                    price: parseFloat(v.price || 0),
                    image: v.canvas2 || v.canvas1 || v.image || ''
                }));
            }
            else if (optionType.includes('color') || optionType.includes('colour') || optionType === '0') {
                converted.type = 'color';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    hex: v.color || v.hex || v.colour || v.color_code || '#CCCCCC',
                    price: parseFloat(v.price || 0)
                }));
            } 
            else if (optionType.includes('dropdown') || optionType.includes('select') || optionType === '1') {
                // Type 1 can be dropdown OR single-character text input
                if (ymqOption.max_char === '1' || ymqOption.max_char === 1) {
                    // Single character text input
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = 1;
                    converted.price = parseFloat(ymqOption.price || 0);
                } else if (values.length > 0) {
                    // Dropdown with values
                    converted.type = 'select';
                    converted.values = values.map(v => ({
                        name: v.label || v.name || v.value || v.title,
                        price: parseFloat(v.price || 0),
                        image: v.canvas2 || v.canvas1 || v.image || ''
                    }));
                } else {
                    // Text input
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = parseInt(ymqOption.max_char || ymqOption.maxLength || ymqOption.max_length || 100);
                    converted.price = parseFloat(ymqOption.price || 0);
                }
            }
            else if (optionType === '3' || optionType === '5') {
                // Type 3 & 5 = Dropdown with single selection (like Nombre de Roses)
                converted.type = 'select';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    price: parseFloat(v.price || 0),
                    image: v.canvas2 || v.canvas1 || v.image || ''
                }));
            }
            else if (optionType.includes('checkbox')) {
                converted.type = 'checkbox';
                converted.values = values.map(v => ({
                    name: v.label || v.name || v.value || v.title,
                    price: parseFloat(v.price || 0)
                }));
            }
            else if (optionType.includes('text') || optionType.includes('textarea') || optionType === '2') {
                converted.type = 'text';
                converted.placeholder = ymqOption.placeholder || '';
                converted.maxlength = parseInt(ymqOption.max_char || ymqOption.maxLength || ymqOption.max_length || 500);
                converted.price = parseFloat(ymqOption.price || 0);
            }
            else {
                // Fallback
                if (values.length > 0) {
                    converted.type = 'select';
                    converted.values = values.map(v => ({
                        name: v.label || v.name || v.value || v.title || String(v),
                        price: parseFloat(v.price || 0),
                        image: v.canvas2 || v.canvas1 || v.image || ''
                    }));
                } else {
                    converted.type = 'text';
                    converted.placeholder = ymqOption.placeholder || '';
                    converted.maxlength = 100;
                    converted.price = 0;
                }
            }
            
            return converted;
        }).filter(opt => {
            // Filter out options without values (unless it's a text input)
            if (opt.type === 'text') return true;
            if (opt.type === 'image-select' && (!opt.values || opt.values.length === 0)) {
                debugLog(`   ⚠️ Filtered out image-select option "${opt.label}" - no values found`);
                return false;
            }
            return opt.values && opt.values.length > 0;
        });
    } catch (error) {
        console.error('❌ Error converting template format:', error.message);
        return null;
    }
}

// ===================================
// ROUTES - COLLECTS (Product-Collection Links)
// ===================================

// Add product to collection
app.post('/api/collects', async (req, res) => {
    try {
        const { product_id, collection_id } = req.body;
        const data = await shopifyAdminRequest('/collects.json', 'POST', {
            collect: {
                product_id,
                collection_id
            }
        });
        debugLog('✅ Product added to collection');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove product from collection
app.delete('/api/collects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await shopifyAdminRequest(`/collects/${id}.json`, 'DELETE');
        debugLog('✅ Product removed from collection');
        res.json({ success: true, message: 'Product removed from collection' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all collections a product belongs to
app.get('/api/products/:id/collects', async (req, res) => {
    try {
        let { id } = req.params;
        // Shopify expects product_id as a string
        id = String(id);
        // Get all collects for this product (links to collections)
        const collectsData = await shopifyAdminRequest(`/collects.json?product_id=${encodeURIComponent(id)}&limit=250`);
        const collects = collectsData.collects || [];
        // Get all collection details in parallel
        const collectionIds = collects.map(c => c.collection_id);
        // Remove duplicates
        const uniqueCollectionIds = [...new Set(collectionIds)];
        const collections = await Promise.all(uniqueCollectionIds.map(async (cid) => {
            // Try custom collection first, fallback to smart
            let collection = null;
            try {
                const data = await shopifyAdminRequest(`/custom_collections/${cid}.json`);
                collection = data.custom_collection;
                if (collection) collection.collection_type = 'custom';
            } catch (e) {
                console.warn(`Custom collection ${cid} not found or error:`, e.message);
            }
            if (!collection) {
                try {
                    const data = await shopifyAdminRequest(`/smart_collections/${cid}.json`);
                    collection = data.smart_collection;
                    if (collection) collection.collection_type = 'smart';
                } catch (e) {
                    console.warn(`Smart collection ${cid} not found or error:`, e.message);
                }
            }
            return collection;
        }));
        // Filter out nulls (in case a collection was deleted)
        res.json({ collections: collections.filter(Boolean) });
    } catch (error) {
        console.error('❌ Error in /api/products/:id/collects:', error);
        let message = error && error.message ? error.message : String(error);
        if (error && error.errors) {
            message += ' | Shopify errors: ' + JSON.stringify(error.errors);
        }
        res.status(500).json({ error: message });
    }
});

// ===================================
// ROUTES - INVENTORY
// ===================================

// ===================================
// ROUTES - PRODUCT IMAGES (Reorder)
// ===================================

// Réordonne les images d'un produit Shopify
app.post('/api/products/:id/images/reorder', async (req, res) => {
    try {
        const { id } = req.params;
        const { imageIds } = req.body;
        if (!Array.isArray(imageIds) || imageIds.length === 0) {
            return res.status(400).json({ error: 'imageIds array required' });
        }
        // Shopify attend { image: { id, position } } pour chaque image
        let position = 1;
        for (const imageId of imageIds) {
            await shopifyAdminRequest(`/products/${id}/images/${imageId}.json`, 'PUT', {
                image: { id: imageId, position }
            });
            position++;
        }
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error reordering images:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - PRODUCT OPTIONS (Update Options)
// ===================================

// Met à jour les options (et leurs valeurs) d'un produit Shopify
app.put('/api/products/:id/options', async (req, res) => {
    try {
        const { id } = req.params;
        const { options } = req.body;

        if (!Array.isArray(options)) {
            return res.status(400).json({ error: 'options array required' });
        }

        const cleanedOptions = options.map((opt, idx) => {
            let name = opt.name ? String(opt.name).trim() : '';
            if (!name || name.toLowerCase().startsWith('option')) {
                name = `Option personnalisee ${idx + 1}`;
            }
            const values = Array.isArray(opt.values)
                ? [...new Set(opt.values.map(v => String(v).trim()).filter(v => !!v && v !== ''))]
                : [];
            return { name, values };
        });


        const productData = await shopifyAdminRequest(`/products/${id}.json`);
        const existingProduct = productData.product || null;
        if (!existingProduct) return res.status(404).json({ error: 'Product not found' });

        const existingOptions = Array.isArray(existingProduct.options) ? existingProduct.options : [];
        const existingVariants = Array.isArray(existingProduct.variants) ? existingProduct.variants : [];
        let linkedOptionNames = new Set();
        try {
            const graphOptions = await getProductOptionsGraph(id);
            linkedOptionNames = new Set(
                (graphOptions || [])
                    .filter(o => !!getPath(o, 'linkedMetafield'))
                    .map(o => normalizeText(getPath(o, 'name')))
            );
        } catch (_) {
            linkedOptionNames = new Set();
        }

        const usedOldIndexes = new Set();
        const mappedOldIndexes = cleanedOptions.map((newOpt, idx) => {
            const wanted = String(newOpt.name || '').toLowerCase();
            let oldIdx = existingOptions.findIndex((oldOpt, i) => {
                if (usedOldIndexes.has(i)) return false;
                return String(getPath(oldOpt, 'name', '') || '').toLowerCase() === wanted;
            });
            if (oldIdx === -1 && idx < existingOptions.length && !usedOldIndexes.has(idx)) oldIdx = idx;
            if (oldIdx >= 0) usedOldIndexes.add(oldIdx);
            return oldIdx;
        });

        const normalizeForOption = (candidate, optionDef) => {
            const vals = Array.isArray(getPath(optionDef, 'values')) ? optionDef.values : [];
            const s = String(candidate || '').trim();
            if (s && vals.includes(s)) return s;
            return vals[0] || '';
        };

        const normalizedVariants = existingVariants.map(variant => {
            const nextVals = cleanedOptions.map((newOpt, idx) => {
                const oldIdx = mappedOldIndexes[idx];
                const fromOld = oldIdx >= 0 ? variant[`option${oldIdx + 1}`] : '';
                return normalizeForOption(fromOld, newOpt);
            });
            return { id: variant.id, values: nextVals };
        });

        if (cleanedOptions.length === 0) {
            let data;
            try {
                await deleteAllProductOptionsGraph(id);
                data = await shopifyAdminRequest(`/products/${id}.json`);
            } catch (graphDeleteErr) {
                if (existingVariants.length > 1) {
                    for (let i = 1; i < existingVariants.length; i++) {
                        try {
                            await shopifyAdminRequest(`/products/${id}/variants/${existingVariants[i].id}.json`, 'DELETE');
                        } catch (delVariantErr) {
                            console.warn('Could not delete duplicate variant while removing all options:', delVariantErr.message || delVariantErr);
                        }
                    }
                }

                try {
                    data = await shopifyAdminRequest(`/products/${id}.json`, 'PUT', {
                        product: {
                            id: parseInt(id),
                            options: []
                        }
                    });
                } catch (restEmptyErr) {
                    const msg = restEmptyErr && restEmptyErr.message ? String(restEmptyErr.message) : String(restEmptyErr);
                    const cannotSetEmpty = msg.includes('could not update options to []');
                    if (!cannotSetEmpty) {
                        throw graphDeleteErr || restEmptyErr;
                    }

                    const latest = await shopifyAdminRequest(`/products/${id}.json`);
                    const keepVariant = Array.isArray(getPath(latest, 'product.variants')) ? latest.product.variants[0] : null;
                    const fallbackProductPayload = {
                        id: parseInt(id),
                        options: [{ name: 'Title' }]
                    };
                    if (getPath(keepVariant, 'id')) {
                        fallbackProductPayload.variants = [{
                            id: keepVariant.id,
                            option1: 'Default Title'
                        }];
                    }

                    data = await shopifyAdminRequest(`/products/${id}.json`, 'PUT', {
                        product: fallbackProductPayload
                    });
                }
            }

            const returnedOptions = [];

            return res.json({ success: true, product: data.product, options: returnedOptions });
        }

        const seen = new Map();
        const kept = [];
        const toDelete = [];
        for (const v of normalizedVariants) {
            const key = v.values.join('||');
            if (!seen.has(key)) {
                seen.set(key, true);
                kept.push(v);
            } else {
                toDelete.push(v.id);
            }
        }

        if (kept.length === 0 && existingVariants.length > 0) {
            const fallbackVals = cleanedOptions.map(opt => (Array.isArray(opt.values) && opt.values.length > 0) ? opt.values[0] : '');
            kept.push({ id: existingVariants[0].id, values: fallbackVals });
        }

        if (toDelete.length > 0) {
            for (const variantId of toDelete) {
                try {
                    await shopifyAdminRequest(`/products/${id}/variants/${variantId}.json`, 'DELETE');
                } catch (e) {
                    console.warn('Could not delete duplicate variant during option sync:', e.message || e);
                }
            }
        }

        const payloadVariants = kept.map(v => {
            const out = { id: v.id };
            for (let i = 0; i < cleanedOptions.length; i++) {
                out[`option${i + 1}`] = v.values[i] || '';
            }
            return out;
        });

        let data;
        try {
            data = await shopifyAdminRequest(`/products/${id}.json`, 'PUT', {
                product: {
                    id: parseInt(id),
                    options: cleanedOptions,
                    variants: payloadVariants
                }
            });
        } catch (e) {
            const msg = e && e.message ? String(e.message) : String(e);
            const linkedMetafieldError = msg.includes('Cannot set name for an option value linked to a metafield');
            const hasLinkedRequestedOption = cleanedOptions.some(opt => linkedOptionNames.has(normalizeText(getPath(opt, 'name'))));
            if (linkedMetafieldError && hasLinkedRequestedOption) {
                // Keep current product state and continue with per-value Graph/REST variant creation below.
                data = { product: existingProduct };
            } else {
                throw e;
            }
        }

        // Shopify only keeps option values that are used by at least one variant.
        // Ensure every declared option value exists on at least one variant by creating
        // minimal variants when needed.
        let createdMissingValueVariant = false;
        let missingValueCreateError = null;
        const productAfterUpdate = getPath(data, 'product', {}) || {};
        const variantsAfterUpdate = Array.isArray(productAfterUpdate.variants) ? productAfterUpdate.variants : [];
        const baseVariant = variantsAfterUpdate[0] || null;

        if (baseVariant && cleanedOptions.length > 0) {
            for (let optIdx = 0; optIdx < cleanedOptions.length; optIdx++) {
                const optionKey = `option${optIdx + 1}`;
                const optionDef = cleanedOptions[optIdx] || { values: [] };
                const desiredValues = Array.isArray(optionDef.values) ? optionDef.values : [];

                for (const desiredValue of desiredValues) {
                    const hasVariantForValue = variantsAfterUpdate.some(v => String(getPath(v, optionKey, '') || '').trim() === String(desiredValue));
                    if (hasVariantForValue) continue;

                    const variantPayload = {
                        price: baseVariant.price || '0.00',
                        compare_at_price: baseVariant.compare_at_price || null,
                        inventory_management: baseVariant.inventory_management || 'shopify',
                        inventory_policy: baseVariant.inventory_policy || 'deny',
                        taxable: typeof baseVariant.taxable === 'boolean' ? baseVariant.taxable : true,
                        requires_shipping: typeof baseVariant.requires_shipping === 'boolean' ? baseVariant.requires_shipping : true,
                        inventory_quantity: 0
                    };

                    for (let i = 0; i < cleanedOptions.length; i++) {
                        const key = `option${i + 1}`;
                        const fallback = getPath(cleanedOptions, [i, 'values', 0], '') || '';
                        const baseVal = baseVariant[key] && String(baseVariant[key]).trim() !== '' ? baseVariant[key] : fallback;
                        variantPayload[key] = (i === optIdx) ? desiredValue : baseVal;
                    }

                    const optionNameForValue = getPath(cleanedOptions, [optIdx, 'name'], '') || '';
                    const shouldUseGraphFirst = linkedOptionNames.has(normalizeText(optionNameForValue));
                    const selections = cleanedOptions.map((opt, i) => ({
                        optionName: opt.name,
                        value: variantPayload[`option${i + 1}`] || ''
                    }));

                    if (shouldUseGraphFirst) {
                        try {
                            const createdViaGraph = await createVariantByOptionValueIds(id, selections, variantPayload.price);
                            if (createdViaGraph) {
                                createdMissingValueVariant = true;
                                const virtualVariant = {};
                                for (let i = 0; i < cleanedOptions.length; i++) {
                                    virtualVariant[`option${i + 1}`] = variantPayload[`option${i + 1}`] || '';
                                }
                                variantsAfterUpdate.push(virtualVariant);
                                continue;
                            }
                        } catch (graphErr) {
                            missingValueCreateError = graphErr && graphErr.message ? String(graphErr.message) : 'Unable to create variant for linked option value';
                            console.warn('GraphQL create failed for linked option value:', graphErr.message || graphErr);
                            continue;
                        }
                    }

                    try {
                        await shopifyAdminRequest(`/products/${id}/variants.json`, 'POST', { variant: variantPayload });
                        createdMissingValueVariant = true;
                        variantsAfterUpdate.push(variantPayload);
                    } catch (e) {
                        const msg = e && e.message ? String(e.message) : String(e);
                        const linkedMetafieldError = msg.includes('Cannot set name for an option value linked to a metafield');
                        if (linkedMetafieldError) {
                            try {
                                const createdViaGraph = await createVariantByOptionValueIds(id, selections, variantPayload.price);
                                if (createdViaGraph) {
                                    createdMissingValueVariant = true;
                                    const virtualVariant = {};
                                    for (let i = 0; i < cleanedOptions.length; i++) {
                                        virtualVariant[`option${i + 1}`] = variantPayload[`option${i + 1}`] || '';
                                    }
                                    variantsAfterUpdate.push(virtualVariant);
                                    continue;
                                }
                            } catch (graphErr) {
                                missingValueCreateError = graphErr && graphErr.message ? String(graphErr.message) : 'Unable to create variant for linked option value';
                                console.warn('GraphQL fallback failed for linked option value:', graphErr.message || graphErr);
                            }
                        }
                        if (!missingValueCreateError) {
                            missingValueCreateError = msg;
                        }
                        console.warn('Could not create variant for missing option value:', msg);
                    }
                }
            }
        }

        if (missingValueCreateError) {
            return res.status(422).json({ error: missingValueCreateError });
        }

        if (createdMissingValueVariant) {
            data = await shopifyAdminRequest(`/products/${id}.json`);
        }

        const returnedOptions = (data && data.product && Array.isArray(data.product.options))
            ? data.product.options.map(o => ({ name: o.name, values: Array.isArray(o.values) ? o.values : [] }))
            : cleanedOptions;

        res.json({ success: true, product: data.product, options: returnedOptions });
    } catch (error) {
        console.error('Error updating product options:', error.message || error);
        res.status(500).json({ error: error.message || String(error) });
    }
});

// Ajouter une seule valeur d'option de façon atomique (évite les races lors d'ajouts rapides)
app.post('/api/products/:id/options/:optionName/values', async (req, res) => {
    try {
        const { id, optionName } = req.params;
        const value = String(getPath(req.body, 'value', '') || '').trim();
        if (!value) return res.status(400).json({ error: 'value required' });

        const productData = await shopifyAdminRequest(`/products/${id}.json`);
        const product = productData.product;
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const existingOptions = Array.isArray(product.options)
            ? product.options.map(o => ({
                name: o.name,
                values: Array.isArray(o.values) ? o.values.slice() : []
            }))
            : [];

        const lower = String(optionName).toLowerCase();
        let found = false;
        let foundIndex = -1;
        let addedValueToExistingOption = false;

        for (let i = 0; i < existingOptions.length; i++) {
            const opt = existingOptions[i];
            if (String(opt.name).toLowerCase() === lower) {
                found = true;
                foundIndex = i;
                if (!opt.values.includes(value)) {
                    opt.values.push(value);
                    addedValueToExistingOption = true;
                }
            }
        }

        if (!found) {
            existingOptions.push({ name: optionName, values: [value] });
            foundIndex = existingOptions.length - 1;
        }

        let payload = { product: { id: parseInt(id), options: existingOptions } };
        if (!found && Array.isArray(product.variants) && product.variants.length > 0) {
            const updatedVariants = product.variants.map(variant => {
                const upd = { id: variant.id };
                for (let i = 0; i < existingOptions.length; i++) {
                    const key = `option${i + 1}`;
                    if (variant[key] && String(variant[key]).trim() !== '') {
                        upd[key] = variant[key];
                    } else {
                        upd[key] = existingOptions[i].values[0] || '';
                    }
                }
                return upd;
            });
            payload.product.variants = updatedVariants;
        }

        let data = await shopifyAdminRequest(`/products/${id}.json`, 'PUT', payload);

        // Shopify only keeps option values that exist on at least one variant.
        // If we add a value to an existing option, create a minimal variant when needed.
        if (found && addedValueToExistingOption && foundIndex >= 0) {
            const optionKey = `option${foundIndex + 1}`;
            const productAfterUpdate = getPath(data, 'product', {}) || {};
            const variantsAfterUpdate = Array.isArray(productAfterUpdate.variants) ? productAfterUpdate.variants : [];
            const alreadyHasValue = variantsAfterUpdate.some(v => String(getPath(v, optionKey, '') || '').trim() === value);

            if (!alreadyHasValue && variantsAfterUpdate.length > 0) {
                const baseVariant = variantsAfterUpdate[0];
                const variantPayload = {
                    price: baseVariant.price || '0.00',
                    compare_at_price: baseVariant.compare_at_price || null,
                    inventory_management: baseVariant.inventory_management || 'shopify',
                    inventory_policy: baseVariant.inventory_policy || 'deny',
                    taxable: typeof baseVariant.taxable === 'boolean' ? baseVariant.taxable : true,
                    requires_shipping: typeof baseVariant.requires_shipping === 'boolean' ? baseVariant.requires_shipping : true,
                    inventory_quantity: 0
                };

                for (let i = 0; i < existingOptions.length; i++) {
                    const key = `option${i + 1}`;
                    const fallback = getPath(existingOptions, [i, 'values', 0], '') || '';
                    variantPayload[key] = (i === foundIndex)
                        ? value
                        : (baseVariant[key] && String(baseVariant[key]).trim() !== '' ? baseVariant[key] : fallback);
                }

                try {
                    await shopifyAdminRequest(`/products/${id}/variants.json`, 'POST', { variant: variantPayload });
                } catch (e) {
                    const msg = e && e.message ? String(e.message) : String(e);
                    const linkedMetafieldError = msg.includes('Cannot set name for an option value linked to a metafield');
                    if (linkedMetafieldError) {
                        const selections = existingOptions.map((opt, i) => ({
                            optionName: opt.name,
                            value: variantPayload[`option${i + 1}`] || ''
                        }));
                        await createVariantByOptionValueIds(id, selections, variantPayload.price);
                    } else {
                        throw e;
                    }
                }
                data = await shopifyAdminRequest(`/products/${id}.json`);
            }
        }

        const returnedOptions = (data && data.product && Array.isArray(data.product.options))
            ? data.product.options.map(o => ({ name: o.name, values: Array.isArray(o.values) ? o.values : [] }))
            : existingOptions;

        res.json({ success: true, product: data.product, options: returnedOptions });
    } catch (error) {
        console.error('Error adding single option value:', error.message || error);
        res.status(500).json({ error: error.message || String(error) });
    }
});

// ===================================
// ROUTES - VARIANTS (Update Variant)
// ===================================

// Update a product variant (price, options, SKU, etc.)
app.put('/api/products/:id/variants/:variantId', async (req, res) => {
    try {
        const { id, variantId } = req.params;
        const variantData = req.body;
        const data = await shopifyAdminRequest(`/variants/${variantId}.json`, 'PUT', {
            variant: variantData
        });
        res.json(data);
    } catch (error) {
        const msg = error && error.message ? String(error.message) : String(error);
        if (msg.includes('Not Found')) {
            return res.status(404).json({ error: 'Variant not found' });
        }
        console.error('Error updating variant:', msg);
        res.status(500).json({ error: msg });
    }
});

// Get inventory levels for a location
app.get('/api/inventory/:inventory_item_id', async (req, res) => {
    try {
        const { inventory_item_id } = req.params;
        const data = await shopifyAdminRequest(`/inventory_levels.json?inventory_item_ids=${inventory_item_id}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update inventory level
app.post('/api/inventory/set', async (req, res) => {
    try {
        const { location_id, inventory_item_id, available } = req.body;
        
        const data = await shopifyAdminRequest('/inventory_levels/set.json', 'POST', {
            location_id,
            inventory_item_id,
            available
        });
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update inventory for a specific variant (auto-detects location)
app.post('/api/inventory/variant', async (req, res) => {
    try {
        const { inventory_item_id, available } = req.body;
        
        if (!inventory_item_id) {
            return res.status(400).json({ error: 'inventory_item_id is required' });
        }

        const parsedInventoryItemId = parseInt(inventory_item_id, 10);
        const parsedAvailable = parseInt(available, 10) || 0;
        const trySetInventory = async (locationId) => {
            return shopifyAdminRequest('/inventory_levels/set.json', 'POST', {
                location_id: locationId,
                inventory_item_id: parsedInventoryItemId,
                available: parsedAvailable
            });
        };

        // Fast path: use cached primary location to avoid an extra lookup on every save.
        let firstError = null;
        const primaryLocationId = await getPrimaryLocationId(false);
        if (primaryLocationId) {
            try {
                const data = await trySetInventory(primaryLocationId);
                return res.json({ success: true, inventory_level: data.inventory_level });
            } catch (e) {
                firstError = e;
                debugLog('Primary location inventory set failed, falling back to current levels lookup.');
            }
        }

        // Fallback path: resolve the currently attached inventory location.
        const levelsData = await shopifyAdminRequest(`/inventory_levels.json?inventory_item_ids=${parsedInventoryItemId}`);
        const levels = Array.isArray(levelsData.inventory_levels) ? levelsData.inventory_levels : [];
        if (levels.length > 0 && levels[0].location_id) {
            const data = await trySetInventory(levels[0].location_id);
            return res.json({ success: true, inventory_level: data.inventory_level });
        }

        // Last chance: refresh cached location and retry.
        const refreshedPrimaryLocationId = await getPrimaryLocationId(true);
        if (!refreshedPrimaryLocationId) {
            return res.status(404).json({ error: 'No location found' });
        }
        const data = await trySetInventory(refreshedPrimaryLocationId);
        return res.json({ success: true, inventory_level: data.inventory_level, warning: firstError ? 'primary_location_retry' : undefined });
    } catch (error) {
        console.error('Error updating variant inventory:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - CUSTOM CHECKOUT (Draft Orders)
// ===================================

/**
 * Create a Draft Order with custom options and correct pricing
 * This allows us to:
 * 1. Add custom line item properties (options like color, accessories, etc.)
 * 2. Apply correct total prices including option surcharges
 * 3. Pre-fill customer shipping address
 * 4. Link order to existing customer if logged in
 */
app.post('/api/checkout/custom', async (req, res) => {
    try {
        const { lines, note, deliveryInfo, customerId } = req.body;

        if (!lines || lines.length === 0) {
            return res.status(400).json({ error: 'No items in cart' });
        }

        // Build line items for Draft Order
        const draftLineItems = [];
        let totalOptionsPrice = 0;
        const allOptionsDetails = [];

        for (const line of lines) {
            const { variantId, quantity, title, options } = line;
            
            // Build properties array for this line item
            const properties = [];
            let lineOptionsPrice = 0;
            
            if (Array.isArray(options) && options.length > 0) {
                options.forEach(opt => {
                    if (opt.name && opt.value) {
                        const optPrice = parseFloat(opt.price || 0);
                        properties.push({
                            name: opt.name,
                            value: opt.value + (optPrice > 0 ? ` (+${optPrice}€)` : '')
                        });
                        lineOptionsPrice += optPrice;
                        
                        if (optPrice > 0) {
                            allOptionsDetails.push(`${opt.value}: +${optPrice}€`);
                        }
                    }
                });
            }

            // Add the product line
            const lineItem = {
                variant_id: parseInt(variantId),
                quantity: quantity
            };
            
            // Add properties if any
            if (properties.length > 0) {
                lineItem.properties = properties;
            }

            draftLineItems.push(lineItem);
            
            // Track total options price (multiply by quantity)
            totalOptionsPrice += lineOptionsPrice * quantity;
        }

        // If there are option surcharges, add a custom line item for them
        if (totalOptionsPrice > 0) {
            draftLineItems.push({
                title: 'Options & Personnalisations',
                price: totalOptionsPrice.toFixed(2),
                quantity: 1,
                taxable: true,
                properties: [
                    { name: 'Détails', value: allOptionsDetails.join(', ') }
                ]
            });
        }

        // Build Draft Order payload
        const draftOrderPayload = {
            draft_order: {
                line_items: draftLineItems,
                use_customer_default_address: false
            }
        };

        // Add note if provided
        if (note) {
            draftOrderPayload.draft_order.note = note;
        }

        // Add shipping address based on delivery mode
        const isPointRelais = deliveryInfo && deliveryInfo.mode === 'france' && deliveryInfo.subMode === 'relais';
        
        if (isPointRelais) {
            // For Point Relais: NO shipping address - customer will select relay point after payment
        } else if (deliveryInfo && (deliveryInfo.street || deliveryInfo.city)) {
            const fullName = String(deliveryInfo.fullName || '').trim();
            const nameParts = fullName.split(/\s+/).filter(Boolean);
            
            draftOrderPayload.draft_order.shipping_address = {
                first_name: nameParts[0] || '',
                last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '',
                address1: deliveryInfo.street || '',
                city: deliveryInfo.city || '',
                zip: deliveryInfo.zip || '',
                country: deliveryInfo.country || 'France',
                country_code: 'FR'
            };
            
            // Copy to billing address
            draftOrderPayload.draft_order.billing_address = { ...draftOrderPayload.draft_order.shipping_address };
        }

        // Link to customer if logged in
        if (customerId) {
            draftOrderPayload.draft_order.customer = {
                id: parseInt(customerId)
            };
        }

        // Add delivery price as a shipping line
        if (deliveryInfo && deliveryInfo.price !== undefined && deliveryInfo.price !== null) {
            const modeLabels = {
                'local': 'Livraison locale My Flowers',
                'france': deliveryInfo.subMode === 'relais' ? 'GLS Point Relais' : 'GLS Domicile',
                'pickup': 'Retrait en boutique'
            };
            
            draftOrderPayload.draft_order.shipping_line = {
                title: modeLabels[deliveryInfo.mode] || 'Livraison',
                price: parseFloat(deliveryInfo.price).toFixed(2),
                custom: true
            };
        }
        
        // Create the Draft Order
        const draftOrderResult = await shopifyAdminRequest('/draft_orders.json', 'POST', draftOrderPayload);

        if (!draftOrderResult.draft_order) {
            console.error('Draft Order creation failed:', draftOrderResult);
            return res.status(500).json({ error: 'Failed to create draft order', details: draftOrderResult });
        }

        const draftOrder = draftOrderResult.draft_order;

        // Resolve a customer-facing invoice URL without completing the draft order
        let checkoutUrl = null;

        const absolutizeCheckoutUrl = (checkoutUrl) => {
            if (!checkoutUrl || typeof checkoutUrl !== 'string') return checkoutUrl;

            const trimmed = checkoutUrl.trim();
            if (!trimmed) return trimmed;

            const storeDomain = (process.env.SHOPIFY_STORE || 'myflowers-secours.myshopify.com')
                .replace(/^https?:\/\//, '');
            const absoluteStore = `https://${storeDomain}`;
            const badHosts = new Set([
                'myflowers-shop.fr',
                'www.myflowers-shop.fr',
                'account.myflowers-shop.fr',
                'account.www.myflowers-shop.fr'
            ]);

            const rewriteParsedUrl = (urlObj) => {
                const host = String(urlObj.hostname || '').toLowerCase();
                if (badHosts.has(host)) {
                    return `${absoluteStore}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                }
                return urlObj.toString();
            };

            if (/^https?:\/\//i.test(trimmed)) {
                try {
                    return rewriteParsedUrl(new URL(trimmed));
                } catch {
                    return trimmed;
                }
            }

            if (trimmed.startsWith('//')) {
                try {
                    return rewriteParsedUrl(new URL(`https:${trimmed}`));
                } catch {
                    return `https:${trimmed}`;
                }
            }

            if (trimmed.startsWith('/')) {
                return `${absoluteStore}${trimmed}`;
            }

            return `${absoluteStore}/${trimmed.replace(/^\/+/, '')}`;
        };

        // Prefer the invoice URL returned immediately by Shopify when creating the draft order.
        checkoutUrl = absolutizeCheckoutUrl(draftOrder.invoice_url);

        // If Shopify hasn't generated it yet, poll the draft order a few times.
        if (!checkoutUrl) {
            for (let attempt = 0; attempt < 5 && !checkoutUrl; attempt++) {
                await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 800 : 1200));

                try {
                    const updatedDraftResult = await shopifyAdminRequest(`/draft_orders/${draftOrder.id}.json`);
                    checkoutUrl = absolutizeCheckoutUrl(updatedDraftResult.draft_order?.invoice_url);
                } catch (e) {
                    console.warn('  Polling invoice_url failed:', e.message);
                }
            }
        }

        if (!checkoutUrl) {
            console.warn('  No valid invoice URL found, frontend will use cart.checkoutUrl fallback');
        }

        checkoutUrl = absolutizeCheckoutUrl(checkoutUrl);

        res.json({
            success: true,
            draftOrderId: draftOrder.id,
            checkoutUrl: checkoutUrl,
            total: draftOrder.total_price
        });

    } catch (error) {
        console.error('❌ Custom checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - ORDERS
// ===================================

// Get all orders
app.get('/api/orders', async (req, res) => {
    try {
        const { limit = 50, status = 'any', financial_status, fulfillment_status } = req.query;
        
        let endpoint = `/orders.json?limit=${limit}&status=${status}`;
        
        if (financial_status) {
            endpoint += `&financial_status=${financial_status}`;
        }
        
        if (fulfillment_status) {
            endpoint += `&fulfillment_status=${fulfillment_status}`;
        }
        
        const data = await shopifyAdminRequest(endpoint);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single order
app.get('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await shopifyAdminRequest(`/orders/${id}.json`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update order
app.put('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const orderData = req.body;
        const data = await shopifyAdminRequest(`/orders/${id}.json`, 'PUT', orderData);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - CUSTOMERS
// ===================================

// Get all customers
app.get('/api/customers', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const data = await shopifyAdminRequest(`/customers.json?limit=${limit}`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single customer
app.get('/api/customers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await shopifyAdminRequest(`/customers/${id}.json`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/customers/:id/marketing - Get marketing preferences
app.get('/api/customers/:id/marketing', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await shopifyAdminRequest(`/customers/${id}.json`);
        const customer = data.customer;
        res.json({
            acceptsMarketing: customer.accepts_marketing || false,
            orderNotifications: true // Shopify always sends order emails, we track this locally
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/customers/:id/marketing - Update marketing preferences
app.put('/api/customers/:id/marketing', async (req, res) => {
    try {
        const { id } = req.params;
        const { acceptsMarketing, customerEmail } = req.body;

        if (customerEmail === undefined || acceptsMarketing === undefined) {
            return res.status(400).json({ error: 'customerEmail et acceptsMarketing requis' });
        }

        // Verify the customer ID matches the email via Admin API
        const customerData = await shopifyAdminRequest(`/customers/${id}.json`);
        if (!customerData.customer || customerData.customer.email.toLowerCase() !== customerEmail.toLowerCase()) {
            return res.status(403).json({ error: 'Client introuvable ou email invalide' });
        }

        // Update marketing preference via Admin API
        const data = await shopifyAdminRequest(`/customers/${id}.json`, 'PUT', {
            customer: {
                id: parseInt(id),
                accepts_marketing: acceptsMarketing
            }
        });

        res.json({
            success: true,
            acceptsMarketing: data.customer.accepts_marketing
        });
    } catch (error) {
        console.error('Error updating marketing preferences:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - LOCATIONS
// ===================================

// Get all locations (for inventory management)
app.get('/api/locations', async (req, res) => {
    try {
        const data = await shopifyAdminRequest('/locations.json');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================================
// ROUTES - BOUTIQUE VISIBILITY
// ===================================

// Get hidden collections list
app.get('/api/boutique-config', (req, res) => {
    const config = loadBoutiqueConfig();
    res.json(config);
});

// Update boutique config (partial update)
app.put('/api/boutique-config', (req, res) => {
    try {
        const config = loadBoutiqueConfig();
        const updates = req.body;
        
        // Merge updates into existing config
        if (updates.collectionIcons !== undefined) {
            config.collectionIcons = { ...config.collectionIcons, ...updates.collectionIcons };
        }
        if (updates.hiddenCollections !== undefined) {
            config.hiddenCollections = updates.hiddenCollections;
        }
        if (updates.featuredCollections !== undefined) {
            config.featuredCollections = updates.featuredCollections;
        }
        if (updates.hiddenProducts !== undefined) {
            config.hiddenProducts = updates.hiddenProducts;
        }
        if (updates.featuredProducts !== undefined) {
            config.featuredProducts = updates.featuredProducts;
        }
        if (updates.collectionProductOrders !== undefined) {
            config.collectionProductOrders = { ...(config.collectionProductOrders || {}), ...updates.collectionProductOrders };
        }
        
        saveBoutiqueConfig(config);
        res.json({ success: true, config });
    } catch (error) {
        console.error('Error updating boutique config:', error);
        res.status(500).json({ error: error.message });
    }
});

// Toggle collection visibility in boutique
app.post('/api/boutique-config/toggle', (req, res) => {
    const { collectionId } = req.body;
    if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
    
    const config = loadBoutiqueConfig();
    const id = String(collectionId);
    const index = config.hiddenCollections.indexOf(id);
    
    if (index === -1) {
        config.hiddenCollections.push(id);
        saveBoutiqueConfig(config);
        res.json({ visible: false, hiddenCollections: config.hiddenCollections });
    } else {
        config.hiddenCollections.splice(index, 1);
        saveBoutiqueConfig(config);
        res.json({ visible: true, hiddenCollections: config.hiddenCollections });
    }
});

// Toggle collection featured on homepage
app.post('/api/boutique-config/toggle-featured', (req, res) => {
    const { collectionId } = req.body;
    if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
    
    const config = loadBoutiqueConfig();
    const id = String(collectionId);
    const index = config.featuredCollections.indexOf(id);
    
    if (index === -1) {
        config.featuredCollections.push(id);
        saveBoutiqueConfig(config);
        res.json({ featured: true, featuredCollections: config.featuredCollections });
    } else {
        config.featuredCollections.splice(index, 1);
        saveBoutiqueConfig(config);
        res.json({ featured: false, featuredCollections: config.featuredCollections });
    }
});

// Toggle product visibility in boutique
app.post('/api/boutique-config/toggle-product', (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    
    const config = loadBoutiqueConfig();
    const id = String(productId);
    const index = config.hiddenProducts.indexOf(id);
    
    if (index === -1) {
        config.hiddenProducts.push(id);
        saveBoutiqueConfig(config);
        res.json({ visible: false, hiddenProducts: config.hiddenProducts });
    } else {
        config.hiddenProducts.splice(index, 1);
        saveBoutiqueConfig(config);
        res.json({ visible: true, hiddenProducts: config.hiddenProducts });
    }
});

// Toggle product featured on homepage
app.post('/api/boutique-config/toggle-product-featured', (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    
    const config = loadBoutiqueConfig();
    const id = String(productId);
    const index = config.featuredProducts.indexOf(id);
    
    if (index === -1) {
        config.featuredProducts.push(id);
        saveBoutiqueConfig(config);
        res.json({ featured: true, featuredProducts: config.featuredProducts });
    } else {
        config.featuredProducts.splice(index, 1);
        saveBoutiqueConfig(config);
        res.json({ featured: false, featuredProducts: config.featuredProducts });
    }
});

// Save product display order for a specific collection
app.post('/api/boutique-config/collection-product-order', (req, res) => {
    const { collectionHandle, productIds } = req.body;
    if (!collectionHandle || !Array.isArray(productIds)) {
        return res.status(400).json({ error: 'collectionHandle and productIds[] required' });
    }
    
    const config = loadBoutiqueConfig();
    if (!config.collectionProductOrders) config.collectionProductOrders = {};
    config.collectionProductOrders[collectionHandle] = productIds;
    saveBoutiqueConfig(config);
    res.json({ success: true, collectionHandle, productIds });
});

// Delete product display order for a specific collection (reset to default)
app.delete('/api/boutique-config/collection-product-order/:handle', (req, res) => {
    const { handle } = req.params;
    const config = loadBoutiqueConfig();
    if (config.collectionProductOrders && config.collectionProductOrders[handle]) {
        delete config.collectionProductOrders[handle];
        saveBoutiqueConfig(config);
    }
    res.json({ success: true, handle });
});

// ===================================
// ROUTES - DELIVERY & PICKUP UNAVAILABLE DATES
// ===================================

// Helper function to clean past dates from an array
function cleanPastDates(dates) {
    if (!dates || !Array.isArray(dates)) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    return dates.filter(dateStr => {
        const date = new Date(dateStr + 'T00:00:00');
        return date >= today;
    });
}

// Unavailable delivery dates
app.get('/api/delivery/unavailable-dates', (req, res) => {
    const config = loadBoutiqueConfig();
    const originalDates = config.unavailableDeliveryDates || [];
    const cleanedDates = cleanPastDates(originalDates);
    
    // Auto-save if dates were cleaned (removed past dates)
    if (cleanedDates.length !== originalDates.length) {
        config.unavailableDeliveryDates = cleanedDates;
        saveBoutiqueConfig(config);
        console.log(`🧹 Auto-cleaned ${originalDates.length - cleanedDates.length} past delivery date(s)`);
    }
    
    res.json({ unavailableDates: cleanedDates });
});
// Add unavailable delivery date
app.post('/api/delivery/unavailable-dates/:date', (req, res) => {
    const { date } = req.params;
    if (!date) return res.status(400).json({ error: 'Date requise' });
    const config = loadBoutiqueConfig();
    if (!config.unavailableDeliveryDates) config.unavailableDeliveryDates = [];
    if (!config.unavailableDeliveryDates.includes(date)) {
        config.unavailableDeliveryDates.push(date);
        saveBoutiqueConfig(config);
    }
    res.json({ unavailableDates: config.unavailableDeliveryDates });
});
// Remove unavailable delivery date
app.delete('/api/delivery/unavailable-dates/:date', (req, res) => {
    const { date } = req.params;
    const config = loadBoutiqueConfig();
    if (!config.unavailableDeliveryDates) config.unavailableDeliveryDates = [];
    config.unavailableDeliveryDates = config.unavailableDeliveryDates.filter(d => d !== date);
    saveBoutiqueConfig(config);
    res.json({ unavailableDates: config.unavailableDeliveryDates });
});

// Unavailable pickup dates
app.get('/api/pickup/unavailable-dates', (req, res) => {
    const config = loadBoutiqueConfig();
    const originalDates = config.unavailablePickupDates || [];
    const cleanedDates = cleanPastDates(originalDates);
    
    // Auto-save if dates were cleaned (removed past dates)
    if (cleanedDates.length !== originalDates.length) {
        config.unavailablePickupDates = cleanedDates;
        saveBoutiqueConfig(config);
        console.log(`🧹 Auto-cleaned ${originalDates.length - cleanedDates.length} past pickup date(s)`);
    }
    
    res.json({ unavailableDates: cleanedDates });
});
// Add unavailable pickup date
app.post('/api/pickup/unavailable-dates/:date', (req, res) => {
    const { date } = req.params;
    if (!date) return res.status(400).json({ error: 'Date requise' });
    const config = loadBoutiqueConfig();
    if (!config.unavailablePickupDates) config.unavailablePickupDates = [];
    if (!config.unavailablePickupDates.includes(date)) {
        config.unavailablePickupDates.push(date);
        saveBoutiqueConfig(config);
    }
    res.json({ unavailableDates: config.unavailablePickupDates });
});
// Remove unavailable pickup date
app.delete('/api/pickup/unavailable-dates/:date', (req, res) => {
    const { date } = req.params;
    const config = loadBoutiqueConfig();
    if (!config.unavailablePickupDates) config.unavailablePickupDates = [];
    config.unavailablePickupDates = config.unavailablePickupDates.filter(d => d !== date);
    saveBoutiqueConfig(config);
    res.json({ unavailableDates: config.unavailablePickupDates });
});

// ===================================
// ADMIN EMAIL VERIFICATION
// ===================================

// POST /api/admin/check-email - Check if email is in admin list (for Shopify customers)
// Security: This only returns true/false after user has already authenticated with Shopify
app.post('/api/admin/check-email', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email requis' });
    }
    
    const config = loadBoutiqueConfig();
    const adminEmails = config.adminEmails || [];
    
    const isAdmin = adminEmails.some(
        adminEmail => adminEmail.toLowerCase() === email.toLowerCase()
    );
    
    // Don't reveal the admin list - just return true/false
    res.json({ isAdmin });
});

// ===================================
// HEALTH CHECK
// ===================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'My Flowers Backend is running',
        shopify_store: SHOPIFY_STORE,
        has_token: canUseStaticToken || canUseClientCredentials
    });
});

// ===================================
// ERROR HANDLING
// ===================================

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// ===================================
// START SERVER
// ===================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║   🌸 My Flowers Backend Server                ║
║   Running on https://myflowers-shop.fr/api          ║
║                                                ║
║   Shopify Store: ${SHOPIFY_STORE}             ║
║   Auth Mode: ${canUseStaticToken ? 'Static token' : 'OAuth auto-refresh'}        ║
║   Collections: ✅ Shopify API                 ║
║                                                ║
║   Ready to manage collections! 🚀             ║
╚════════════════════════════════════════════════╝
    `);
    
    if (!canUseStaticToken && !canUseClientCredentials) {
        console.warn('⚠️  WARNING: Configure SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET');
    }
    
    // Initialise l'automatisation des tokens
    setupTokenAutomation();
});


module.exports = app;


