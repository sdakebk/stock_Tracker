/**
 * Main Application Logic for Stock Tracker
 * Coordinates between storage, API, and UI components with localStorage persistence
 */

class StockTrackerApp {
    constructor() {
        this.storage = window.stockStorage;
        this.api = window.stockAPI;
        this.refreshInterval = null;
        this.autoRefreshEnabled = false;
        this.autoRefreshIntervalMs = 5 * 60 * 1000; // 5 minutes

        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        // Check if localStorage is available
        if (!this.storage.isLocalStorageAvailable()) {
            this.showMessage('LocalStorage not available. Data will not persist.', 'warning');
        }

        this.setupEventListeners();
        this.renderStocks();
        this.updateMarketStatus();
        this.showStorageInfo();
        
        // Auto-refresh during market hours
        this.startAutoRefresh();
        
        console.log('Stock Tracker App initialized with localStorage');
        console.log('Storage stats:', this.storage.getStats());
        console.log('Storage quota:', this.storage.getStorageQuota());
    }

    /**
     * Set up all event listeners
     */
    setupEventListeners() {
        // Add stock form
        const addStockForm = document.getElementById('addStockForm');
        addStockForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddStock();
        });

        // Refresh all button
        const refreshAllBtn = document.getElementById('refreshAllBtn');
        refreshAllBtn.addEventListener('click', () => {
            this.handleRefreshAll();
        });

        // Export button
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.addEventListener('click', () => {
            this.handleExport();
        });

        // Import button and file input
        const importBtn = document.getElementById('importBtn');
        const importInput = document.getElementById('importInput');
        
        importBtn.addEventListener('click', () => {
            importInput.click();
        });
        
        importInput.addEventListener('change', (e) => {
            this.handleImport(e);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'r':
                        e.preventDefault();
                        this.handleRefreshAll();
                        break;
                    case 's':
                        e.preventDefault();
                        this.handleExport();
                        break;
                    case 'i':
                        e.preventDefault();
                        importInput.click();
                        break;
                }
            }
            
            // Clear all data with Ctrl+Shift+Delete
            if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
                e.preventDefault();
                this.handleClearAllData();
            }
        });

        // Handle page visibility change for auto-refresh
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // Page became visible, refresh if data is stale
                this.checkAndRefreshStaleData();
            }
        });

        // Handle before page unload for backup reminder
        window.addEventListener('beforeunload', (e) => {
            const stats = this.storage.getStats();
            const lastBackup = this.storage.settings.lastBackup;
            
            // Warn if user has data but no recent backup
            if (stats.totalStocks > 0 && (!lastBackup || 
                new Date() - new Date(lastBackup) > 7 * 24 * 60 * 60 * 1000)) {
                e.preventDefault();
                e.returnValue = 'You have unsaved stock data. Consider exporting your data before leaving.';
            }
        });
    }

    /**
     * Handle adding a new stock
     */
    async handleAddStock() {
        const symbolInput = document.getElementById('stockSymbol');
        const targetInput = document.getElementById('targetPrice');
        const addBtn = document.getElementById('addBtn');

        const symbol = symbolInput.value.trim().toUpperCase();
        const targetPrice = parseFloat(targetInput.value) || null;

        // Validation
        if (!symbol) {
            this.showMessage('Please enter a stock symbol', 'error');
            symbolInput.focus();
            return;
        }

        if (!this.api.validateSymbol(symbol)) {
            this.showMessage('Invalid stock symbol format (1-10 alphanumeric characters)', 'error');
            symbolInput.focus();
            return;
        }

        // Check if stock already exists
        if (this.storage.getStock(symbol)) {
            this.showMessage(`${symbol} already exists in your portfolio`, 'error');
            symbolInput.focus();
            return;
        }

        // Disable form while processing
        this.setFormDisabled(true);
        addBtn.textContent = 'Adding...';

        try {
            // Add to storage first
            const added = this.storage.addStock({ symbol, targetPrice });
            
            if (!added) {
                throw new Error('Failed to add stock to storage');
            }

            // Update UI immediately
            this.renderStocks();

            // Fetch price data
            await this.updateStockPrice(symbol);

            // Clear form
            symbolInput.value = '';
            targetInput.value = '';
            
            this.showMessage(`${symbol} added successfully!`, 'success');
            
            // Focus back to symbol input for easy addition of more stocks
            symbolInput.focus();
        } catch (error) {
            console.error('Error adding stock:', error);
            this.storage.removeStock(symbol); // Clean up if price fetch failed
            this.showMessage(`Error adding ${symbol}: ${error.message}`, 'error');
        } finally {
            this.setFormDisabled(false);
            addBtn.textContent = 'Add Stock';
            this.renderStocks();
        }
    }

    /**
     * Handle refreshing all stock prices
     */
    async handleRefreshAll() {
        const stocks = this.storage.getAllStocks();
        
        if (stocks.length === 0) {
            this.showMessage('No stocks to refresh', 'info');
            return;
        }

        const refreshBtn = document.getElementById('refreshAllBtn');
        const originalText = refreshBtn.textContent;
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';

        // Set all stocks to loading state
        stocks.forEach(stock => {
            this.storage.updateStock(stock.symbol, { loading: true, error: null });
        });
        this.renderStocks();

        let successCount = 0;
        let errorCount = 0;

        try {
            const symbols = stocks.map(s => s.symbol);
            
            // Use batch fetch with progress tracking
            await this.api.batchFetch(symbols, (progress) => {
                refreshBtn.textContent = `Refreshing... ${progress.percentage}%`;
            });

            // Update all stocks with new data
            for (const stock of stocks) {
                try {
                    await this.updateStockPrice(stock.symbol);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to update ${stock.symbol}:`, error);
                    errorCount++;
                }
            }

            // Show appropriate message based on results
            if (errorCount === 0) {
                this.showMessage(`All ${successCount} stocks refreshed successfully!`, 'success');
            } else if (successCount > 0) {
                this.showMessage(`${successCount} stocks refreshed, ${errorCount} failed`, 'warning');
            } else {
                this.showMessage('Failed to refresh any stocks', 'error');
            }
        } catch (error) {
            console.error('Error refreshing stocks:', error);
            this.showMessage('Error occurred while refreshing stocks', 'error');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = originalText;
            this.renderStocks();
        }
    }

    /**
     * Check and refresh stale data
     */
    checkAndRefreshStaleData() {
        const stocks = this.storage.getAllStocks();
        const staleThreshold = 10 * 60 * 1000; // 10 minutes
        const now = new Date();

        const staleStocks = stocks.filter(stock => {
            if (!stock.lastUpdated) return true;
            return now - new Date(stock.lastUpdated) > staleThreshold;
        });

        if (staleStocks.length > 0) {
            console.log(`Found ${staleStocks.length} stale stocks, refreshing...`);
            this.handleRefreshAll();
        }
    }

    /**
     * Update price for a specific stock
     * @param {string} symbol - Stock symbol
     */
    async updateStockPrice(symbol) {
        try {
            this.storage.updateStock(symbol, { loading: true, error: null });
            this.renderStocks();

            const result = await this.api.fetchStockPrice(symbol);
            
            if (result.success) {
                this.storage.updateStock(symbol, {
                    currentPrice: result.price,
                    change: result.change,
                    changePercent: result.changePercent,
                    loading: false,
                    error: null
                });
            } else {
                this.storage.updateStock(symbol, {
                    loading: false,
                    error: result.error || 'Failed to fetch price'
                });
            }
        } catch (error) {
            console.error(`Error updating ${symbol}:`, error);
            this.storage.updateStock(symbol, {
                loading: false,
                error: error.message || 'Unknown error'
            });
        }
        
        this.renderStocks();
    }

    /**
     * Handle removing a stock
     * @param {string} symbol - Stock symbol to remove
     */
    handleRemoveStock(symbol) {
        if (confirm(`Remove ${symbol} from your portfolio?\n\nThis action cannot be undone.`)) {
            const removed = this.storage.removeStock(symbol);
            if (removed) {
                this.renderStocks();
                this.showMessage(`${symbol} removed from portfolio`, 'success');
            } else {
                this.showMessage(`Failed to remove ${symbol}`, 'error');
            }
        }
    }

    /**
     * Handle clearing all data
     */
    handleClearAllData() {
        const stocks = this.storage.getAllStocks();
        if (stocks.length === 0) {
            this.showMessage('No data to clear', 'info');
            return;
        }

        const confirmed = confirm(
            `Clear ALL data including ${stocks.length} stocks?\n\n` +
            'This will permanently delete all your stocks and settings.\n' +
            'Consider exporting your data first.\n\n' +
            'This action cannot be undone!'
        );

        if (confirmed) {
            const doubleConfirm = confirm('Are you absolutely sure? This cannot be undone!');
            if (doubleConfirm) {
                this.storage.clearStorage();
                this.renderStocks();
                this.showMessage('All data cleared successfully', 'success');
            }
        }
    }

    /**
     * Handle updating target price
     * @param {string} symbol - Stock symbol
     * @param {string} value - New target price value
     */
    handleUpdateTargetPrice(symbol, value) {
        const targetPrice = value ? parseFloat(value) : null;
        
        if (value && (isNaN(targetPrice) || targetPrice <= 0)) {
            this.showMessage('Target price must be a positive number', 'error');
            this.renderStocks(); // Reset the input
            return;
        }

        const updated = this.storage.updateTargetPrice(symbol, targetPrice);
        
        if (updated) {
            this.renderStocks();
            if (targetPrice) {
                this.showMessage(`Target price for ${symbol} set to $${targetPrice.toFixed(2)}`, 'success');
            } else {
                this.showMessage(`Target price for ${symbol} removed`, 'success');
            }
        }
    }

    /**
     * Handle data export
     */
    handleExport() {
        try {
            const data = this.storage.exportData();
            if (!data) {
                this.showMessage('Failed to export data', 'error');
                return;
            }

            // Create and download file
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stock-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Update export timestamp
            this.storage.saveSettings({ lastExport: new Date().toISOString() });

            const stats = this.storage.getStats();
            this.showMessage(`Data exported successfully! (${stats.totalStocks} stocks)`, 'success');
        } catch (error) {
            console.error('Export error:', error);
            this.showMessage('Failed to export data', 'error');
        }
    }

    /**
     * Handle data import
     * @param {Event} event - File input change event
     */
    async handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Check file size (limit to 10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.showMessage('File too large (max 10MB)', 'error');
            event.target.value = '';
            return;
        }

        const mergeOption = confirm(
            'Import Options:\n\n' +
            'OK = Merge with existing data\n' +
            'Cancel = Replace all existing data\n\n' +
            'Choose your import method:'
        );

        try {
            const text = await file.text();
            const imported = this.storage.importData(text, mergeOption);
            
            if (imported) {
                this.renderStocks();
                const stats = this.storage.getStats();
                this.showMessage(
                    `Data imported successfully! (${stats.totalStocks} total stocks)`, 
                    'success'
                );
                
                // Optionally refresh all imported stocks
                if (confirm('Refresh prices for all stocks?')) {
                    this.handleRefreshAll();
                }
            } else {
                this.showMessage('Failed to import data - invalid format', 'error');
            }
        } catch (error) {
            console.error('Import error:', error);
            this.showMessage(`Failed to import data: ${error.message}`, 'error');
        } finally {
            // Clear the file input
            event.target.value = '';
        }
    }

    /**
     * Show storage information
     */
    showStorageInfo() {
        const stats = this.storage.getStats();
        if (stats.totalStocks > 0) {
            console.log('Portfolio loaded:', {
                stocks: stats.totalStocks,
                withTargets: stats.stocksWithTargets,
                storageSize: stats.storageSize
            });
        }
    }

    /**
     * Render all stocks in the UI
     */
    renderStocks() {
        const container = document.getElementById('stocksContainer');
        const stocks = this.storage.getAllStocks();

        if (stocks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No stocks added yet</p>
                    <p>Add your first stock above to get started</p>
                    <p><small>Your data will be saved locally in your browser</small></p>
                </div>
            `;
            return;
        }

        // Sort stocks by symbol for consistent display
        const sortedStocks = [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol));

        const tableHtml = `
            <div class="portfolio-summary">
                <p><strong>Portfolio:</strong> ${stocks.length} stocks | 
                <strong>Storage:</strong> ${this.storage.getStats().storageSize}</p>
            </div>
            <table class="stocks-table">
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Current Price</th>
                        <th>Change</th>
                        <th>Target Price</th>
                        <th>Status</th>
                        <th>Last Updated</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedStocks.map(stock => this.renderStockRow(stock)).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = tableHtml;
    }

    /**
     * Render a single stock row
     * @param {Object} stock - Stock object
     * @returns {string} HTML string for the row
     */
    renderStockRow(stock) {
        const priceDisplay = this.getPriceDisplay(stock);
        const changeDisplay = this.getChangeDisplay(stock);
        const statusDisplay = this.getStatusDisplay(stock);
        const lastUpdatedDisplay = this.getLastUpdatedDisplay(stock);

        return `
            <tr>
                <td class="stock-symbol">${stock.symbol}</td>
                <td class="stock-price">${priceDisplay}</td>
                <td class="stock-change">${changeDisplay}</td>
                <td>
                    <input 
                        type="number" 
                        class="target-input"
                        value="${stock.targetPrice || ''}" 
                        placeholder="Target"
                        step="0.01"
                        min="0"
                        onchange="app.handleUpdateTargetPrice('${stock.symbol}', this.value)"
                        title="Set target price for ${stock.symbol}"
                    >
                </td>
                <td>${statusDisplay}</td>
                <td class="last-updated">${lastUpdatedDisplay}</td>
                <td>
                    <button 
                        class="delete-btn" 
                        onclick="app.handleRemoveStock('${stock.symbol}')"
                        title="Remove ${stock.symbol} from portfolio"
                    >
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Get price display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted price display
     */
    getPriceDisplay(stock) {
        if (stock.loading) {
            return '<span class="loading">Loading...</span>';
        }
        if (stock.error) {
            return `<span class="error" title="${stock.error}">Error</span>`;
        }
        if (stock.currentPrice !== null) {
            return `${stock.currentPrice.toFixed(2)}`;
        }
        return '<span class="neutral">N/A</span>';
    }

    /**
     * Get change display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted change display
     */
    getChangeDisplay(stock) {
        if (stock.change === null || stock.changePercent === null) {
            return '<span class="neutral">—</span>';
        }

        const changeClass = stock.change > 0 ? 'positive' : stock.change < 0 ? 'negative' : 'neutral';
        const changeSign = stock.change > 0 ? '+' : '';
        
        return `
            <span class="${changeClass}" title="Change: ${changeSign}${stock.change.toFixed(2)} (${stock.changePercent.toFixed(2)}%)">
                ${changeSign}${stock.change.toFixed(2)}<br>
                <small>(${stock.changePercent.toFixed(2)}%)</small>
            </span>
        `;
    }

    /**
     * Get status display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted status display
     */
    getStatusDisplay(stock) {
        if (!stock.targetPrice || stock.currentPrice === null) {
            return '<span class="neutral">—</span>';
        }

        let statusClass, statusText, percentage;
        const diff = stock.currentPrice - stock.targetPrice;
        const percentDiff = (diff / stock.targetPrice) * 100;
        
        if (Math.abs(percentDiff) < 0.1) { // Within 0.1%
            statusClass = 'status-at';
            statusText = 'At Target';
            percentage = '';
        } else if (stock.currentPrice > stock.targetPrice) {
            statusClass = 'status-above';
            statusText = 'Above Target';
            percentage = `+${percentDiff.toFixed(1)}%`;
        } else {
            statusClass = 'status-below';
            statusText = 'Below Target';
            percentage = `${percentDiff.toFixed(1)}%`;
        }

        return `
            <span class="status-badge ${statusClass}" title="Target: ${stock.targetPrice.toFixed(2)} | Current: ${stock.currentPrice.toFixed(2)}">
                ${statusText}
                ${percentage && `<br><small>${percentage}</small>`}
            </span>
        `;
    }

    /**
     * Get last updated display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted last updated display
     */
    getLastUpdatedDisplay(stock) {
        if (!stock.lastUpdated) {
            return '<span class="neutral">Never</span>';
        }

        const lastUpdated = new Date(stock.lastUpdated);
        const now = new Date();
        const diffMs = now - lastUpdated;
        const diffMins = Math.floor(diffMs / 60000);

        let timeText;
        if (diffMins < 1) {
            timeText = 'Just now';
        } else if (diffMins < 60) {
            timeText = `${diffMins}m ago`;
        } else if (diffMins < 1440) {
            timeText = `${Math.floor(diffMins / 60)}h ago`;
        } else {
            timeText = lastUpdated.toLocaleDateString();
        }

        const isStale = diffMins > 15;
        const className = isStale ? 'neutral' : '';
        
        return `<span class="${className}" title="Last updated: ${lastUpdated.toLocaleString()}">${timeText}</span>`;
    }

    /**
     * Update market status display
     */
    updateMarketStatus() {
        const status = this.api.getMarketStatus();
        const statusText = status.isOpen ? 'Market Open' : 'Market Closed';
        
        // Update page title to include market status
        document.title = `Stock Tracker Pro - ${statusText}`;
        
        console.log(`Market Status: ${statusText}`);
    }

    /**
     * Start auto-refresh during market hours
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(() => {
            const status = this.api.getMarketStatus();
            const stocks = this.storage.getAllStocks();
            
            // Only auto-refresh if market is open and we have stocks
            if (status.isOpen && stocks.length > 0) {
                console.log('Auto-refreshing stock prices...');
                this.handleRefreshAll();
            }
            
            // Update market status regardless
            this.updateMarketStatus();
        }, this.autoRefreshIntervalMs);

        console.log(`Auto-refresh enabled (every ${this.autoRefreshIntervalMs / 60000} minutes)`);
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('Auto-refresh disabled');
        }
    }

    /**
     * Set form disabled state
     * @param {boolean} disabled - Whether to disable the form
     */
    setFormDisabled(disabled) {
        const symbolInput = document.getElementById('stockSymbol');
        const targetInput = document.getElementById('targetPrice');
        const addBtn = document.getElementById('addBtn');

        symbolInput.disabled = disabled;
        targetInput.disabled = disabled;
        addBtn.disabled = disabled;
    }

    /**
     * Show message to user
     * @param {string} message - Message text
     * @param {string} type - Message type (success, error, warning, info)
     */
    showMessage(message, type = 'info') {
        // Create or update message display
        let messageEl = document.getElementById('messageDisplay');
        
        if (!messageEl) {
            messageEl = document.createElement('div');
            messageEl.id = 'messageDisplay';
            messageEl.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 600;
                z-index: 1000;
                transition: all 0.3s ease;
                max-width: 350px;
                word-wrap: break-word;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            `;
            document.body.appendChild(messageEl);
        }

        // Set message and styling based on type
        messageEl.textContent = message;
        
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        
        messageEl.style.backgroundColor = colors[type] || colors.info;
        messageEl.style.display = 'block';
        messageEl.style.opacity = '1';

        // Auto-hide after duration based on message type
        const duration = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            messageEl.style.opacity = '0';
            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 300);
        }, duration);

        // Log to console as well
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    /**
     * Get app statistics for debugging
     * @returns {Object} App statistics
     */
    getAppStats() {
        return {
            storage: this.storage.getStats(),
            quota: this.storage.getStorageQuota(),
            api: this.api.getCacheStats(),
            autoRefresh: {
                enabled: !!this.refreshInterval,
                interval: this.autoRefreshIntervalMs / 60000 + ' minutes'
            },
            localStorage: this.storage.isLocalStorageAvailable()
        };
    }

    /**
     * Cleanup when app is destroyed
     */
    destroy() {
        this.stopAutoRefresh();
        
        // Remove event listeners
        const elements = ['addStockForm', 'refreshAllBtn', 'exportBtn', 'importBtn'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.removeEventListener('click', () => {});
                el.removeEventListener('submit', () => {});
                el.removeEventListener('change', () => {});
            }
        });

        console.log('Stock Tracker App destroyed');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new StockTrackerApp();
    
    // Expose app stats to console for debugging
    window.getAppStats = () => window.app.getAppStats();
    console.log('App stats available via getAppStats()');
});