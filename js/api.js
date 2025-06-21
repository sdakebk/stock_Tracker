/**
 * Stock API Management for Stock Tracker
 * Handles all external API calls and data fetching
 */

class StockAPI {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        this.requestQueue = [];
        this.isProcessing = false;
        this.rateLimitDelay = 1000; // 1 second between requests
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
            // Primary API: Yahoo Finance Chart API
            const result = await this.fetchFromYahooChart(upperSymbol);
            if (result.success) {
                return result;
            }
        } catch (error) {
            console.error(`Primary API failed for ${symbol}:`, error);
        }

        try {
            // Fallback API: Yahoo Finance Quote Summary
            const result = await this.fetchFromYahooQuote(upperSymbol);
            if (result.success) {
                return result;
            }
        } catch (error) {
            console.error(`Fallback API failed for ${symbol}:`, error);
        }

        // If both APIs fail, return error
        throw new Error('All API endpoints failed');
    }

    /**
     * Fetch from Yahoo Finance Chart API
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} API response
     */
    async fetchFromYahooChart(symbol) {
        const proxyUrl = 'https://api.allorigins.win/raw?url=';
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
        const url = proxyUrl + encodeURIComponent(targetUrl);

        console.log(`Fetching from Chart API: ${symbol}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            throw new Error('No chart data available');
        }

        const result = data.chart.result[0];
        const meta = result.meta;

        if (!meta || !meta.regularMarketPrice) {
            throw new Error('Missing price data in response');
        }

        const currentPrice = meta.regularMarketPrice;
        const previousClose = meta.previousClose || meta.chartPreviousClose;
        const change = currentPrice - previousClose;
        const changePercent = (change / previousClose) * 100;

        return {
            success: true,
            price: parseFloat(currentPrice.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume: meta.regularMarketVolume || null,
            marketCap: meta.marketCap || null,
            currency: meta.currency || 'USD',
            source: 'yahoo_chart'
        };
    }

    /**
     * Fetch from Yahoo Finance Quote Summary API
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object>} API response
     */
    async fetchFromYahooQuote(symbol) {
        const proxyUrl = 'https://api.allorigins.win/raw?url=';
        const targetUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price`;
        const url = proxyUrl + encodeURIComponent(targetUrl);

        console.log(`Fetching from Quote API: ${symbol}`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.quoteSummary || !data.quoteSummary.result || 
            data.quoteSummary.result.length === 0) {
            throw new Error('No quote data available');
        }

        const priceData = data.quoteSummary.result[0].price;

        if (!priceData || !priceData.regularMarketPrice) {
            throw new Error('Missing price data in quote response');
        }

        const currentPrice = priceData.regularMarketPrice.raw;
        const previousClose = priceData.regularMarketPreviousClose.raw;
        const change = currentPrice - previousClose;
        const changePercent = (change / previousClose) * 100;

        return {
            success: true,
            price: parseFloat(currentPrice.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            volume: priceData.regularMarketVolume?.raw || null,
            marketCap: priceData.marketCap?.raw || null,
            currency: priceData.currency || 'USD',
            source: 'yahoo_quote'
        };
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
     * Get market status (simplified)
     * @returns {Object} Market status info
     */
    getMarketStatus() {
        const now = new Date();
        const day = now.getDay(); // 0 = Sunday, 6 = Saturday
        const hour = now.getHours();

        // Basic US market hours check (9:30 AM - 4:00 PM ET, Monday-Friday)
        // This is simplified and doesn't account for holidays or timezone differences
        const isWeekday = day >= 1 && day <= 5;
        const isMarketHours = hour >= 9 && hour < 16;

        return {
            isOpen: isWeekday && isMarketHours,
            nextOpen: this.getNextMarketOpen(now),
            timezone: 'ET'
        };
    }

    /**
     * Calculate next market open time (simplified)
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
     * Get supported exchanges/markets
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
}

// Create global API instance
window.stockAPI = new StockAPI();