/**
 * Data Storage Management for Stock Tracker
 * Handles persistent storage of stock data and user preferences
 */

class StockStorage {
    constructor() {
        this.storageKey = 'stockTracker_data';
        this.stocks = this.loadStocks();
    }

    /**
     * Load stocks from storage
     * @returns {Array} Array of stock objects
     */
    loadStocks() {
        try {
            // Note: Using in-memory storage for Claude.ai compatibility
            // In a real environment, you would use localStorage:
            // const data = localStorage.getItem(this.storageKey);
            
            if (window.stockTrackerData) {
                return window.stockTrackerData;
            }
            return [];
        } catch (error) {
            console.error('Error loading stocks from storage:', error);
            return [];
        }
    }

    /**
     * Save stocks to storage
     * @param {Array} stocks - Array of stock objects to save
     */
    saveStocks(stocks) {
        try {
            this.stocks = stocks;
            // Note: Using in-memory storage for Claude.ai compatibility
            // In a real environment, you would use localStorage:
            // localStorage.setItem(this.storageKey, JSON.stringify(stocks));
            
            window.stockTrackerData = stocks;
            console.log('Stocks saved to storage');
        } catch (error) {
            console.error('Error saving stocks to storage:', error);
        }
    }

    /**
     * Add a new stock
     * @param {Object} stock - Stock object to add
     * @returns {boolean} Success status
     */
    addStock(stock) {
        try {
            // Check if stock already exists
            if (this.stocks.find(s => s.symbol === stock.symbol)) {
                throw new Error('Stock already exists');
            }

            // Create stock object with default values
            const newStock = {
                id: this.generateId(),
                symbol: stock.symbol.toUpperCase(),
                targetPrice: stock.targetPrice || null,
                currentPrice: null,
                change: null,
                changePercent: null,
                lastUpdated: null,
                loading: false,
                error: null,
                dateAdded: new Date().toISOString()
            };

            this.stocks.push(newStock);
            this.saveStocks(this.stocks);
            return true;
        } catch (error) {
            console.error('Error adding stock:', error);
            return false;
        }
    }

    /**
     * Remove a stock by symbol
     * @param {string} symbol - Stock symbol to remove
     * @returns {boolean} Success status
     */
    removeStock(symbol) {
        try {
            const initialLength = this.stocks.length;
            this.stocks = this.stocks.filter(stock => stock.symbol !== symbol);
            
            if (this.stocks.length < initialLength) {
                this.saveStocks(this.stocks);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error removing stock:', error);
            return false;
        }
    }

    /**
     * Update stock data
     * @param {string} symbol - Stock symbol
     * @param {Object} data - Data to update
     * @returns {boolean} Success status
     */
    updateStock(symbol, data) {
        try {
            const stockIndex = this.stocks.findIndex(s => s.symbol === symbol);
            if (stockIndex === -1) {
                return false;
            }

            this.stocks[stockIndex] = {
                ...this.stocks[stockIndex],
                ...data,
                lastUpdated: new Date().toISOString()
            };

            this.saveStocks(this.stocks);
            return true;
        } catch (error) {
            console.error('Error updating stock:', error);
            return false;
        }
    }

    /**
     * Update target price for a stock
     * @param {string} symbol - Stock symbol
     * @param {number|null} targetPrice - New target price
     * @returns {boolean} Success status
     */
    updateTargetPrice(symbol, targetPrice) {
        return this.updateStock(symbol, { targetPrice });
    }

    /**
     * Get all stocks
     * @returns {Array} Array of all stocks
     */
    getAllStocks() {
        return [...this.stocks];
    }

    /**
     * Get a specific stock by symbol
     * @param {string} symbol - Stock symbol
     * @returns {Object|null} Stock object or null if not found
     */
    getStock(symbol) {
        return this.stocks.find(s => s.symbol === symbol) || null;
    }

    /**
     * Clear all stocks
     * @returns {boolean} Success status
     */
    clearAllStocks() {
        try {
            this.stocks = [];
            this.saveStocks(this.stocks);
            return true;
        } catch (error) {
            console.error('Error clearing stocks:', error);
            return false;
        }
    }

    /**
     * Export stocks data as JSON
     * @returns {string} JSON string of stocks data
     */
    exportData() {
        try {
            const exportData = {
                stocks: this.stocks,
                exportDate: new Date().toISOString(),
                version: '1.0'
            };
            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            console.error('Error exporting data:', error);
            return null;
        }
    }

    /**
     * Import stocks data from JSON
     * @param {string} jsonData - JSON string containing stocks data
     * @param {boolean} merge - Whether to merge with existing data or replace
     * @returns {boolean} Success status
     */
    importData(jsonData, merge = false) {
        try {
            const data = JSON.parse(jsonData);
            
            // Validate data structure
            if (!data.stocks || !Array.isArray(data.stocks)) {
                throw new Error('Invalid data format');
            }

            // Validate each stock object
            const validStocks = data.stocks.filter(stock => {
                return stock.symbol && typeof stock.symbol === 'string';
            });

            if (merge) {
                // Merge with existing stocks, avoiding duplicates
                const existingSymbols = this.stocks.map(s => s.symbol);
                const newStocks = validStocks.filter(s => !existingSymbols.includes(s.symbol));
                this.stocks = [...this.stocks, ...newStocks];
            } else {
                // Replace all stocks
                this.stocks = validStocks;
            }

            // Ensure all stocks have required properties
            this.stocks = this.stocks.map(stock => ({
                id: stock.id || this.generateId(),
                symbol: stock.symbol.toUpperCase(),
                targetPrice: stock.targetPrice || null,
                currentPrice: stock.currentPrice || null,
                change: stock.change || null,
                changePercent: stock.changePercent || null,
                lastUpdated: stock.lastUpdated || null,
                loading: false,
                error: null,
                dateAdded: stock.dateAdded || new Date().toISOString()
            }));

            this.saveStocks(this.stocks);
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }

    /**
     * Generate unique ID for stocks
     * @returns {string} Unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Get storage statistics
     * @returns {Object} Storage statistics
     */
    getStats() {
        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        
        return {
            totalStocks: this.stocks.length,
            stocksWithTargets: this.stocks.filter(s => s.targetPrice).length,
            recentlyUpdated: this.stocks.filter(s => 
                s.lastUpdated && new Date(s.lastUpdated) > oneDayAgo
            ).length,
            oldestStock: this.stocks.length > 0 ? 
                Math.min(...this.stocks.map(s => new Date(s.dateAdded))) : null
        };
    }
}

// Create global storage instance
window.stockStorage = new StockStorage();