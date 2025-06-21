/**
 * Data Storage Management for Stock Tracker
 * Handles persistent storage of stock data and user preferences using localStorage
 */

class StockStorage {
    constructor() {
        this.storageKey = 'stockTracker_data';
        this.settingsKey = 'stockTracker_settings';
        this.stocks = this.loadStocks();
        this.settings = this.loadSettings();
    }

    /**
     * Load stocks from localStorage
     * @returns {Array} Array of stock objects
     */
    loadStocks() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                // Validate that it's an array
                if (Array.isArray(parsed)) {
                    console.log(`Loaded ${parsed.length} stocks from localStorage`);
                    return parsed;
                }
            }
            console.log('No existing stock data found in localStorage');
            return [];
        } catch (error) {
            console.error('Error loading stocks from localStorage:', error);
            // If localStorage is corrupted, clear it and start fresh
            this.clearStorage();
            return [];
        }
    }

    /**
     * Load settings from localStorage
     * @returns {Object} Settings object
     */
    loadSettings() {
        try {
            const data = localStorage.getItem(this.settingsKey);
            if (data) {
                return JSON.parse(data);
            }
            return this.getDefaultSettings();
        } catch (error) {
            console.error('Error loading settings from localStorage:', error);
            return this.getDefaultSettings();
        }
    }

    /**
     * Get default settings
     * @returns {Object} Default settings
     */
    getDefaultSettings() {
        return {
            autoRefresh: true,
            refreshInterval: 5, // minutes
            currency: 'USD',
            theme: 'light',
            notifications: true
        };
    }

    /**
     * Save stocks to localStorage
     * @param {Array} stocks - Array of stock objects to save
     */
    saveStocks(stocks) {
        try {
            this.stocks = stocks;
            localStorage.setItem(this.storageKey, JSON.stringify(stocks));
            console.log(`Saved ${stocks.length} stocks to localStorage`);
        } catch (error) {
            console.error('Error saving stocks to localStorage:', error);
            
            // Check if we hit storage quota
            if (error.name === 'QuotaExceededError') {
                alert('Storage quota exceeded. Please delete some stocks or clear browser data.');
            }
        }
    }

    /**
     * Save settings to localStorage
     * @param {Object} settings - Settings object to save
     */
    saveSettings(settings) {
        try {
            this.settings = { ...this.settings, ...settings };
            localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
            console.log('Settings saved to localStorage');
        } catch (error) {
            console.error('Error saving settings to localStorage:', error);
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
                console.log(`Removed stock: ${symbol}`);
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
            console.log('All stocks cleared');
            return true;
        } catch (error) {
            console.error('Error clearing stocks:', error);
            return false;
        }
    }

    /**
     * Clear all localStorage data
     */
    clearStorage() {
        try {
            localStorage.removeItem(this.storageKey);
            localStorage.removeItem(this.settingsKey);
            this.stocks = [];
            this.settings = this.getDefaultSettings();
            console.log('LocalStorage cleared');
        } catch (error) {
            console.error('Error clearing localStorage:', error);
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
                settings: this.settings,
                exportDate: new Date().toISOString(),
                version: '1.0',
                appName: 'Stock Tracker Pro'
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
                throw new Error('Invalid data format - missing stocks array');
            }

            // Validate each stock object
            const validStocks = data.stocks.filter(stock => {
                return stock.symbol && typeof stock.symbol === 'string';
            });

            if (validStocks.length === 0) {
                throw new Error('No valid stocks found in import data');
            }

            if (merge) {
                // Merge with existing stocks, avoiding duplicates
                const existingSymbols = this.stocks.map(s => s.symbol);
                const newStocks = validStocks.filter(s => !existingSymbols.includes(s.symbol));
                this.stocks = [...this.stocks, ...newStocks];
                console.log(`Merged ${newStocks.length} new stocks`);
            } else {
                // Replace all stocks
                this.stocks = validStocks;
                console.log(`Replaced all stocks with ${validStocks.length} imported stocks`);
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

            // Import settings if available
            if (data.settings && typeof data.settings === 'object') {
                this.settings = { ...this.getDefaultSettings(), ...data.settings };
                this.saveSettings(this.settings);
            }

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
        
        // Calculate localStorage usage
        let storageSize = 0;
        try {
            const stockData = localStorage.getItem(this.storageKey) || '';
            const settingsData = localStorage.getItem(this.settingsKey) || '';
            storageSize = (stockData.length + settingsData.length) * 2; // Rough estimate in bytes
        } catch (error) {
            console.error('Error calculating storage size:', error);
        }
        
        return {
            totalStocks: this.stocks.length,
            stocksWithTargets: this.stocks.filter(s => s.targetPrice).length,
            stocksWithErrors: this.stocks.filter(s => s.error).length,
            recentlyUpdated: this.stocks.filter(s => 
                s.lastUpdated && new Date(s.lastUpdated) > oneDayAgo
            ).length,
            oldestStock: this.stocks.length > 0 ? 
                new Date(Math.min(...this.stocks.map(s => new Date(s.dateAdded)))).toLocaleDateString() : null,
            newestStock: this.stocks.length > 0 ? 
                new Date(Math.max(...this.stocks.map(s => new Date(s.dateAdded)))).toLocaleDateString() : null,
            storageSize: `${(storageSize / 1024).toFixed(2)} KB`,
            lastExport: this.settings.lastExport || 'Never'
        };
    }

    /**
     * Get storage quota information
     * @returns {Object} Storage quota info
     */
    getStorageQuota() {
        try {
            // Estimate localStorage usage
            let totalSize = 0;
            for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    totalSize += localStorage[key].length;
                }
            }
            
            return {
                used: `${(totalSize / 1024).toFixed(2)} KB`,
                estimated: totalSize,
                available: 'Unknown (varies by browser)'
            };
        } catch (error) {
            return {
                used: 'Unknown',
                estimated: 0,
                available: 'Unknown'
            };
        }
    }

    /**
     * Backup data to file
     * @returns {boolean} Success status
     */
    createBackup() {
        try {
            const backupData = this.exportData();
            if (backupData) {
                // Update last backup time in settings
                this.saveSettings({ lastBackup: new Date().toISOString() });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error creating backup:', error);
            return false;
        }
    }

    /**
     * Check if localStorage is available
     * @returns {boolean} Whether localStorage is available
     */
    isLocalStorageAvailable() {
        try {
            const test = '__localStorage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (error) {
            console.error('localStorage is not available:', error);
            return false;
        }
    }
}

// Create global storage instance
window.stockStorage = new StockStorage();