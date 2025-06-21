/**
 * Data Storage Management for Stock Tracker
 * Handles persistent storage of stock data and user preferences
 */

class StockStorage {
    constructor() {
        this.storageKey = 'stockTracker_data';
        this.stocks = [];
        
        // Initialize storage system first
        if (this.initializeStorage()) {
            // Load existing stocks only if storage is available
            this.stocks = this.loadStocks();
        }
        
        console.log(`StockStorage initialized with ${this.stocks.length} stocks`);
    }

    /**
     * Load stocks from storage
     * @returns {Array} Array of stock objects
     */
    loadStocks() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                // Validate that parsed data is an array
                if (Array.isArray(parsed)) {
                    console.log(`Loaded ${parsed.length} stocks from localStorage`);
                    return parsed;
                }
            }
            console.log('No existing stock data found, starting fresh');
            return [];
        } catch (error) {
            console.error('Error loading stocks from localStorage:', error);
            // Try to recover by clearing corrupted data
            this.clearCorruptedData();
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
            localStorage.setItem(this.storageKey, JSON.stringify(stocks));
            console.log(`Saved ${stocks.length} stocks to localStorage`);
        } catch (error) {
            console.error('Error saving stocks to localStorage:', error);
            
            // Handle quota exceeded error
            if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                this.handleStorageQuotaExceeded();
            }
        }
    }

    /**
     * Handle storage quota exceeded by cleaning old data
     */
    handleStorageQuotaExceeded() {
        console.warn('LocalStorage quota exceeded, attempting to free space...');
        
        try {
            // Remove old cache data if it exists
            const keys = Object.keys(localStorage);
            const oldKeys = keys.filter(key => 
                key.startsWith('stockTracker_cache_') || 
                key.startsWith('temp_') ||
                key.includes('_old')
            );
            
            oldKeys.forEach(key => localStorage.removeItem(key));
            
            // Try saving again with just essential data
            const essentialStocks = this.stocks.map(stock => ({
                id: stock.id,
                symbol: stock.symbol,
                targetPrice: stock.targetPrice,
                dateAdded: stock.dateAdded
            }));
            
            localStorage.setItem(this.storageKey, JSON.stringify(essentialStocks));
            console.log('Successfully saved essential stock data after cleanup');
            
        } catch (retryError) {
            console.error('Failed to save even after cleanup:', retryError);
            alert('Storage is full. Please export your data and consider clearing browser storage.');
        }
    }

    /**
     * Clear corrupted data and reset storage
     */
    clearCorruptedData() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('Cleared corrupted stock data from localStorage');
        } catch (error) {
            console.error('Error clearing corrupted data:', error);
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
     * Get storage usage information
     * @returns {Object} Storage usage stats
     */
    getStorageInfo() {
        try {
            const used = new Blob([localStorage.getItem(this.storageKey) || '']).size;
            const total = this.getStorageQuota();
            
            return {
                used: used,
                total: total,
                available: total - used,
                usedFormatted: this.formatBytes(used),
                totalFormatted: this.formatBytes(total),
                percentUsed: Math.round((used / total) * 100)
            };
        } catch (error) {
            console.error('Error getting storage info:', error);
            return null;
        }
    }

    /**
     * Estimate localStorage quota (browser dependent)
     * @returns {number} Estimated quota in bytes
     */
    getStorageQuota() {
        // Most browsers have 5-10MB localStorage limit
        // This is an estimation since actual quota detection is complex
        return 5 * 1024 * 1024; // 5MB default assumption
    }

    /**
     * Format bytes to human readable format
     * @param {number} bytes - Bytes to format
     * @returns {string} Formatted string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Check if localStorage is available and working
     * @returns {boolean} Whether localStorage is functional
     */
    isStorageAvailable() {
        try {
            const testKey = 'stockTracker_test';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (error) {
            console.error('LocalStorage not available:', error);
            return false;
        }
    }

    /**
     * Create backup of current data in localStorage
     * @returns {boolean} Success status
     */
    createBackup() {
        try {
            const backupKey = `${this.storageKey}_backup_${Date.now()}`;
            const currentData = localStorage.getItem(this.storageKey);
            
            if (currentData) {
                localStorage.setItem(backupKey, currentData);
                console.log('Backup created:', backupKey);
                
                // Clean old backups (keep only last 3)
                this.cleanOldBackups();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error creating backup:', error);
            return false;
        }
    }

    /**
     * Clean old backup files, keeping only the most recent ones
     */
    cleanOldBackups() {
        try {
            const keys = Object.keys(localStorage);
            const backupKeys = keys
                .filter(key => key.startsWith(`${this.storageKey}_backup_`))
                .sort((a, b) => {
                    const timeA = parseInt(a.split('_').pop());
                    const timeB = parseInt(b.split('_').pop());
                    return timeB - timeA; // Sort descending (newest first)
                });

            // Remove all but the 3 most recent backups
            if (backupKeys.length > 3) {
                const toDelete = backupKeys.slice(3);
                toDelete.forEach(key => {
                    localStorage.removeItem(key);
                    console.log('Removed old backup:', key);
                });
            }
        } catch (error) {
            console.error('Error cleaning old backups:', error);
        }
    }

    /**
     * Restore from most recent backup
     * @returns {boolean} Success status
     */
    restoreFromBackup() {
        try {
            const keys = Object.keys(localStorage);
            const backupKeys = keys
                .filter(key => key.startsWith(`${this.storageKey}_backup_`))
                .sort((a, b) => {
                    const timeA = parseInt(a.split('_').pop());
                    const timeB = parseInt(b.split('_').pop());
                    return timeB - timeA;
                });

            if (backupKeys.length === 0) {
                console.log('No backups found');
                return false;
            }

            const latestBackup = backupKeys[0];
            const backupData = localStorage.getItem(latestBackup);
            
            if (backupData) {
                localStorage.setItem(this.storageKey, backupData);
                this.stocks = this.loadStocks();
                console.log('Restored from backup:', latestBackup);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error restoring from backup:', error);
            return false;
        }
    }

    /**
     * Initialize storage with device-specific setup
     */
    initializeStorage() {
        console.log('Initializing localStorage for Stock Tracker...');
        
        // Check if localStorage is available
        if (!this.isStorageAvailable()) {
            console.error('LocalStorage is not available on this device');
            alert('Warning: Data storage is not available. Your stocks will not be saved between sessions.');
            return false;
        }

        // Create initial backup if data exists
        const existingData = localStorage.getItem(this.storageKey);
        if (existingData) {
            this.createBackup();
        }

        // Log device info for debugging
        const deviceInfo = this.getDeviceInfo();
        console.log('Device Info:', deviceInfo);

        // Log storage info
        const storageInfo = this.getStorageInfo();
        if (storageInfo) {
            console.log(`Storage: ${storageInfo.usedFormatted} / ${storageInfo.totalFormatted} used (${storageInfo.percentUsed}%)`);
        }

        return true;
    }

    /**
     * Check if localStorage is available and working
     * @returns {boolean} Whether localStorage is functional
     */
    isStorageAvailable() {
        try {
            const testKey = 'stockTracker_test';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (error) {
            console.error('LocalStorage not available:', error);
            return false;
        }
    }

    /**
     * Get device/browser information for storage identification
     * @returns {Object} Device info
     */
    getDeviceInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            storageAvailable: this.isStorageAvailable()
        };
    }
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
                Math.min(...this.stocks.map(s => new Date(s.dateAdded))) : null,
            storageInfo: this.getStorageInfo(),
            deviceInfo: this.getDeviceInfo()
        };
    }

// Create global storage instance
window.stockStorage = new StockStorage();