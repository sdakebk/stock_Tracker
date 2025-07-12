/**
 * Stock API Management for Stock Tracker
 * Optimized Finnhub API with existing data structure preservation
 */

class StockAPI {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes for efficiency
        this.requestQueue = [];
        this.isProcessing = false;
        this.rateLimitDelay = 1200; // 1.2 seconds between requests
        
        // Quota management
        this.dailyRequestCount = this.loadDailyRequestCount();
        this.maxDailyRequests = 50; // Conservative limit
        this.lastResetDate = this.loadLastResetDate();
        
        console.log('🔧 StockAPI initialized with Finnhub optimization');
    }

    /**
     * Fetch stock price with caching and rate limiting
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} Stock data or error
     */
    async fetchStockPrice(symbol) {
        // Check daily quota first
        if (!this.canMakeRequest()) {
            console.warn(`Daily API quota exceeded (${this.dailyRequestCount}/${this.maxDailyRequests})`);
            return {
                success: false,
                error: 'Daily API quota exceeded. Please try again tomorrow.'
            };
        }

        // Check cache first
        const cached = this.getFromCache(symbol);
        if (cached) {
            const remainingTime = this.getRemainingCacheTime(symbol);
            console.log(`📋 Using cached data for ${symbol} (${remainingTime} min remaining)`);
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
        
        // Double-check quota
        if (!this.canMakeRequest()) {
            throw new Error('Daily API quota exceeded');
        }

        try {
            // Increment counter BEFORE request
            this.incrementRequestCount();
            
            const result = await this.fetchFromFinnhub(upperSymbol);
            if (result.success) {
                console.log(`✅ API success for ${symbol} (${this.dailyRequestCount}/${this.maxDailyRequests} used)`);
                return result;
            }
        } catch (error) {
            console.error(`❌ Finnhub API failed for ${symbol}:`, error);
        }
        throw new Error('Finnhub API failed');
    }

    /**
     * Fetch from Finnhub API - KEEPING SAME DATA FORMAT AS BEFORE
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
                
                // IMPORTANT: Return in SAME FORMAT as your original 12data structure
                return {
                    success: true,
                    price: parseFloat(currentPrice.toFixed(2)),
                    change: parseFloat(change.toFixed(2)),
                    changePercent: parseFloat(changePercent.toFixed(2)),
                    volume: null, // Keep same as before
                    marketCap: null, // Keep same as before
                    currency: 'USD',
                    source: 'finnhub'
                };
            } else {
                return {
                    success: false,
                    error: data.error || 'No price data returned from Finnhub'
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
     * Batch fetch multiple stocks with smart quota management
     * @param {Array<string>} symbols - Array of stock symbols
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Promise<Array>} Array of results
     */
    async batchFetch(symbols, progressCallback = null) {
        // Check quota and limit batch size
        const availableRequests = this.maxDailyRequests - this.dailyRequestCount;
        const symbolsToFetch = symbols.slice(0, Math.min(symbols.length, availableRequests));
        
        if (symbolsToFetch.length < symbols.length) {
            console.warn(`⚠️ Batch limited to ${symbolsToFetch.length}/${symbols.length} symbols due to quota`);
        }

        const results = [];
        const total = symbolsToFetch.length;

        for (let i = 0; i < symbolsToFetch.length; i++) {
            const symbol = symbolsToFetch[i];
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
                    quotaUsed: this.dailyRequestCount,
                    quotaLimit: this.maxDailyRequests
                });
            }
        }

        // Add skipped symbols due to quota
        const skippedSymbols = symbols.slice(symbolsToFetch.length);
        skippedSymbols.forEach(symbol => {
            results.push({
                symbol,
                success: false,
                error: 'Skipped due to daily quota limit'
            });
        });

        return results;
    }

    /**
     * Get market status (simplified - same as before)
     * @returns {Object} Market status info
     */
    getMarketStatus() {
        const now = new Date();
        const day = now.getDay(); // 0 = Sunday, 6 = Saturday
        const hour = now.getHours();

        // Basic US market hours check (9:30 AM - 4:00 PM ET, Monday-Friday)
        const isWeekday = day >= 1 && day <= 5;
        const isMarketHours = hour >= 9 && hour < 16;

        return {
            isOpen: isWeekday && isMarketHours,
            nextOpen: this.getNextMarketOpen(now),
            timezone: 'ET'
        };
    }

    /**
     * Calculate next market open time (simplified - same as before)
     * @param {Date} now - Current date
     * @returns {Date} Next market open date
     */
    getNextMarketOpen(now) {
        const nextOpen = new Date(now);
        
        // If it's weekend, move to next Monday
        if (now.getDay() === 0) { // Sunday
            nextOpen.setDate(now.getDate() + 1);
        } else if (now.getDay() === 6) { // Saturday
            nextOpen.setDate(now.getDate() + 2);
        } else if (now.getHours() >= 16) { // After market close
            nextOpen.setDate(now.getDate() + 1);
        }

        // Set to 9:30 AM
        nextOpen.setHours(9, 30, 0, 0);
        
        return nextOpen;
    }

    /**
     * Get supported exchanges/markets (same as before)
     * @returns {Array} List of supported markets
     */
    getSupportedMarkets() {
        return [
            { code: 'US', name: 'United States', exchanges: ['NASDAQ', 'NYSE', 'AMEX'] },
            { code: 'CA', name: 'Canada', exchanges: ['TSX', 'TSXV'] },
            { code: 'UK', name: 'United Kingdom', exchanges: ['LSE'] },
            { code: 'DE', name: 'Germany', exchanges: ['XETRA'] },
            { code: 'JP', name: 'Japan', exchanges: ['TSE'] },
            { code: 'AU', name: 'Australia', exchanges: ['ASX'] }
        ];
    }

    // NEW: Quota Management Methods
    
    canMakeRequest() {
        this.checkAndResetDailyCounter();
        return this.dailyRequestCount < this.maxDailyRequests;
    }

    incrementRequestCount() {
        this.checkAndResetDailyCounter();
        this.dailyRequestCount++;
        this.saveDailyRequestCount();
    }

    checkAndResetDailyCounter() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.dailyRequestCount = 0;
            this.lastResetDate = today;
            this.saveLastResetDate();
            console.log('🔄 Daily API quota reset');
        }
    }

    loadDailyRequestCount() {
        try {
            return parseInt(localStorage.getItem('finnhub_daily_requests') || '0');
        } catch {
            return 0;
        }
    }

    saveDailyRequestCount() {
        try {
            localStorage.setItem('finnhub_daily_requests', this.dailyRequestCount.toString());
        } catch (error) {
            console.error('Failed to save daily request count:', error);
        }
    }

    loadLastResetDate() {
        try {
            return localStorage.getItem('finnhub_last_reset') || new Date().toDateString();
        } catch {
            return new Date().toDateString();
        }
    }

    saveLastResetDate() {
        try {
            localStorage.setItem('finnhub_last_reset', this.lastResetDate);
        } catch (error) {
            console.error('Failed to save last reset date:', error);
        }
    }

    getRemainingCacheTime(symbol) {
        const cached = this.cache.get(symbol.toUpperCase());
        if (!cached) return 0;
        
        const elapsed = Date.now() - cached.timestamp;
        const remaining = Math.max(0, this.cacheExpiry - elapsed);
        return Math.round(remaining / 60000); // Return minutes
    }

    getQuotaStatus() {
        this.checkAndResetDailyCounter();
        return {
            used: this.dailyRequestCount,
            limit: this.maxDailyRequests,
            remaining: this.maxDailyRequests - this.dailyRequestCount,
            resetTime: 'Midnight UTC',
            canMakeRequest: this.canMakeRequest()
        };
    }

    /**
     * Test API connection with quota awareness
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection() {
        console.log('🧪 Testing Finnhub API connection...');
        
        if (!this.canMakeRequest()) {
            return {
                success: false,
                message: `Daily quota exceeded (${this.dailyRequestCount}/${this.maxDailyRequests})`,
                data: null
            };
        }
        
        try {
            const result = await this.fetchStockPrice('AAPL');
            return {
                success: result.success,
                message: result.success ? 
                    `Finnhub API connection successful (${this.dailyRequestCount}/${this.maxDailyRequests} quota used)` : 
                    'API returned error',
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

// Test connection on load with quota info
window.stockAPI.testConnection().then(result => {
    if (result.success) {
        console.log('✅ Finnhub API ready');
        console.log('📊 Quota status:', window.stockAPI.getQuotaStatus());
    } else {
        console.error('❌ Finnhub API connection failed:', result.message);
    }
});