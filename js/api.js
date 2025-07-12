/**
 * Stock API Management for Stock Tracker
 * Handles all external API calls and data fetching
 * Updated to use Finnhub API
 */

class StockAPI {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        this.requestQueue = [];
        this.isProcessing = false;
        this.rateLimitDelay = 1000; // 1 second between requests (conservative for free tier)
    }

    /**
     * Fetch stock price with caching and rate limiting
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} Stock data or error
     */
    async fetchStockPrice(symbol) {
        // Check cache first
        const cached = this.getFromCache(symbol);
        if (cached) {
            console.log(`Using cached data for ${symbol}`);
            return cached;
        }

        // Add to queue and process
        return new Promise((resolve) => {
            this.requestQueue.push({ symbol, resolve });
            this.processQueue();
        });
    }

    /**
     * Process API request queue with rate limiting
     */
    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const { symbol, resolve } = this.requestQueue.shift();
            
            try {
                const result = await this.makeAPIRequest(symbol);
                this.setCache(symbol, result);
                resolve(result);
            } catch (error) {
                resolve({
                    success: false,
                    error: error.message || 'Failed to fetch stock data'
                });
            }

            // Rate limiting delay
            if (this.requestQueue.length > 0) {
                await this.delay(this.rateLimitDelay);
            }
        }

        this.isProcessing = false;
    }

    /**
     * Make actual API request to fetch stock data
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} Stock data
     */
    async makeAPIRequest(symbol) {
        const upperSymbol = symbol.toUpperCase();
        try {
            const result = await this.fetchFromFinnhub(upperSymbol);
            if (result.success) {
                return result;
            }
        } catch (error) {
            console.error(`Finnhub API failed for ${symbol}:`, error);
        }
        throw new Error('Finnhub API failed');
    }

    /**
     * Fetch from Finnhub API
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} API response
     */
    async fetchFromFinnhub(symbol) {
        const apiKey = 'd0t1tphr01qid5qc847gd0t1tphr01qid5qc8480';
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
        
        try {
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Finnhub returns: { c: current, h: high, l: low, o: open, pc: previous close, t: timestamp }
            if (data.c !== undefined && data.c !== null && data.c > 0) {
                const currentPrice = data.c;
                const previousClose = data.pc;
                const change = currentPrice - previousClose;
                const changePercent = ((change / previousClose) * 100);
                
                return {
                    success: true,
                    price: parseFloat(currentPrice.toFixed(2)),
                    change: parseFloat(change.toFixed(2)),
                    changePercent: parseFloat(changePercent.toFixed(2)),
                    previousClose: parseFloat(previousClose.toFixed(2)),
                    high: data.h ? parseFloat(data.h.toFixed(2)) : null,
                    low: data.l ? parseFloat(data.l.toFixed(2)) : null,
                    open: data.o ? parseFloat(data.o.toFixed(2)) : null,
                    volume: null, // Not available in quote endpoint
                    marketCap: null, // Not available in quote endpoint
                    currency: 'USD',
                    timestamp: data.t,
                    source: 'finnhub'
                };
            } else {
                // Check if it's an error response
                if (data.error) {
                    return {
                        success: false,
                        error: data.error
                    };
                }
                
                return {
                    success: false,
                    error: 'No price data returned from Finnhub - symbol may not exist'
                };
            }
        } catch (error) {
            console.error('Finnhub API error:', error);
            return {
                success: false,
                error: error.message || 'Failed to fetch from Finnhub'
            };
        }
    }

    /**
     * Fetch company profile from Finnhub (bonus feature)
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} Company data
     */
    async fetchCompanyProfile(symbol) {
        const apiKey = 'd0t1tphr01qid5qc847gd0t1tphr01qid5qc8480';
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.name) {
                return {
                    success: true,
                    name: data.name,
                    ticker: data.ticker,
                    exchange: data.exchange,
                    industry: data.finnhubIndustry,
                    marketCap: data.marketCapitalization,
                    country: data.country,
                    currency: data.currency,
                    website: data.weburl,
                    logo: data.logo
                };
            } else {
                return {
                    success: false,
                    error: 'Company not found'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validate stock symbol format
     * @param {string} symbol - Stock symbol to validate
     * @returns {boolean} Whether symbol is valid
     */
    validateSymbol(symbol) {
        if (!symbol || typeof symbol !== 'string') {
            return false;
        }

        // Basic validation: 1-10 characters, letters and numbers only
        const symbolRegex = /^[A-Za-z0-9]{1,10}$/;
        return symbolRegex.test(symbol.trim());
    }

    /**
     * Get data from cache
     * @param {string} symbol - Stock symbol
     * @returns {Object|null} Cached data or null
     */
    getFromCache(symbol) {
        const cached = this.cache.get(symbol.toUpperCase());
        if (!cached) return null;

        const now = Date.now();
        if (now - cached.timestamp > this.cacheExpiry) {
            this.cache.delete(symbol.toUpperCase());
            return null;
        }

        return cached.data;
    }

    /**
     * Set data in cache
     * @param {string} symbol - Stock symbol
     * @param {Object} data - Data to cache
     */
    setCache(symbol, data) {
        this.cache.set(symbol.toUpperCase(), {
            data,
            timestamp: Date.now()
        });

        // Limit cache size to prevent memory issues
        if (this.cache.size > 100) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('API cache cleared');
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys())
        };
    }

    /**
     * Utility function to delay execution
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} Promise that resolves after delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Batch fetch multiple stocks
     * @param {Array<string>} symbols - Array of stock symbols
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Promise<Array>} Array of results
     */
    async batchFetch(symbols, progressCallback = null) {
        const results = [];
        const total = symbols.length;

        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            try {
                const result = await this.fetchStockPrice(symbol);
                results.push({ symbol, ...result });
            } catch (error) {
                results.push({
                    symbol,
                    success: false,
                    error: error.message
                });
            }

            // Call progress callback if provided
            if (progressCallback) {
                progressCallback({
                    current: i + 1,
                    total,
                    percentage: Math.round(((i + 1) / total) * 100),
                    symbol
                });
            }
        }

        return results;
    }

    /**
     * Get market status from Finnhub
     * @returns {Promise<Object>} Market status info
     */
    async getMarketStatus() {
        const apiKey = 'd0t1tphr01qid5qc847gd0t1tphr01qid5qc8480';
        
        try {
            const response = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${apiKey}`);
            const data = await response.json();
            
            return {
                isOpen: data.isOpen || false,
                session: data.session || 'unknown',
                timezone: data.timezone || 'America/New_York',
                source: 'finnhub'
            };
        } catch (error) {
            // Fallback to simple time-based check
            const now = new Date();
            const day = now.getDay();
            const hour = now.getHours();
            const isWeekday = day >= 1 && day <= 5;
            const isMarketHours = hour >= 9 && hour < 16;

            return {
                isOpen: isWeekday && isMarketHours,
                session: 'estimated',
                timezone: 'ET',
                source: 'fallback'
            };
        }
    }

    /**
     * Get supported exchanges/markets
     * @returns {Array} List of supported markets
     */
    getSupportedMarkets() {
        return [
            { code: 'US', name: 'United States', exchanges: ['NASDAQ', 'NYSE', 'AMEX'] },
            { code: 'CA', name: 'Canada', exchanges: ['TSX'] },
            { code: 'EU', name: 'Europe', exchanges: ['LSE', 'XETRA', 'EPA'] },
            { code: 'AS', name: 'Asia', exchanges: ['TSE', 'HKEX', 'SSE'] }
        ];
    }

    /**
     * Test API connection
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection() {
        console.log('Testing Finnhub API connection...');
        
        try {
            const result = await this.fetchStockPrice('AAPL');
            return {
                success: result.success,
                message: result.success ? 'Finnhub API connection successful' : 'API returned error',
                data: result
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to connect to Finnhub API',
                error: error.message
            };
        }
    }
}

// Create global API instance
window.stockAPI = new StockAPI();

// Auto-test connection when loaded
window.stockAPI.testConnection().then(result => {
    if (result.success) {
        console.log('✅ Finnhub API ready');
    } else {
        console.error('❌ Finnhub API connection failed:', result.message);
    }
});