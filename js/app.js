/**
 * Main Application Logic for Stock Tracker
 * Coordinates between storage, API, and UI components
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
        this.setupEventListeners();
        this.renderStocks();
        this.updateMarketStatus();
        
        // Auto-refresh during market hours
        this.startAutoRefresh();
        
        console.log('Stock Tracker App initialized');
        console.log('Storage stats:', this.storage.getStats());
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
                }
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
            return;
        }

        if (!this.api.validateSymbol(symbol)) {
            this.showMessage('Invalid stock symbol format', 'error');
            return;
        }

        // Check if stock already exists
        if (this.storage.getStock(symbol)) {
            this.showMessage('Stock already exists in your portfolio', 'error');
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

        try {
            const symbols = stocks.map(s => s.symbol);
            
            // Use batch fetch with progress tracking
            await this.api.batchFetch(symbols, (progress) => {
                refreshBtn.textContent = `Refreshing... ${progress.percentage}%`;
            });

            // Update all stocks with new data
            for (const stock of stocks) {
                await this.updateStockPrice(stock.symbol);
            }

            this.showMessage('All stocks refreshed successfully!', 'success');
        } catch (error) {
            console.error('Error refreshing stocks:', error);
            this.showMessage('Some stocks failed to refresh', 'warning');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = originalText;
            this.renderStocks();
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
        if (confirm(`Remove ${symbol} from your portfolio?`)) {
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
     * Handle updating target price
     * @param {string} symbol - Stock symbol
     * @param {string} value - New target price value
     */
    handleUpdateTargetPrice(symbol, value) {
        const targetPrice = value ? parseFloat(value) : null;
        const updated = this.storage.updateTargetPrice(symbol, targetPrice);
        
        if (updated) {
            this.renderStocks();
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
            a.download = `stock-tracker-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showMessage('Data exported successfully!', 'success');
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

        try {
            const text = await file.text();
            const imported = this.storage.importData(text, false); // Replace existing data
            
            if (imported) {
                this.renderStocks();
                this.showMessage('Data imported successfully!', 'success');
                
                // Optionally refresh all imported stocks
                if (confirm('Refresh prices for all imported stocks?')) {
                    this.handleRefreshAll();
                }
            } else {
                this.showMessage('Failed to import data - invalid format', 'error');
            }
        } catch (error) {
            console.error('Import error:', error);
            this.showMessage('Failed to import data', 'error');
        } finally {
            // Clear the file input
            event.target.value = '';
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
                </div>
            `;
            return;
        }

        const tableHtml = `
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
                    ${stocks.map(stock => this.renderStockRow(stock)).join('')}
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
                    >
                </td>
                <td>${statusDisplay}</td>
                <td class="last-updated">${lastUpdatedDisplay}</td>
                <td>
                    <button 
                        class="delete-btn" 
                        onclick="app.handleRemoveStock('${stock.symbol}')"
                        title="Remove ${stock.symbol}"
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
            return `<span class="error">${stock.error}</span>`;
        }
        if (stock.currentPrice !== null) {
            return `$${stock.currentPrice.toFixed(2)}`;
        }
        return 'N/A';
    }

    /**
     * Get change display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted change display
     */
    getChangeDisplay(stock) {
        if (stock.change === null || stock.changePercent === null) {
            return '';
        }

        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const changeSign = stock.change >= 0 ? '+' : '';
        
        return `
            <span class="${changeClass}">
                ${changeSign}$${stock.change.toFixed(2)} (${stock.changePercent.toFixed(2)}%)
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
            return '';
        }

        let statusClass, statusText;
        
        if (stock.currentPrice > stock.targetPrice) {
            statusClass = 'status-above';
            statusText = 'Above Target';
        } else if (stock.currentPrice < stock.targetPrice) {
            statusClass = 'status-below';
            statusText = 'Below Target';
        } else {
            statusClass = 'status-at';
            statusText = 'At Target';
        }

        return `<span class="status-badge ${statusClass}">${statusText}</span>`;
    }

    /**
     * Get last updated display string
     * @param {Object} stock - Stock object
     * @returns {string} Formatted last updated display
     */
    getLastUpdatedDisplay(stock) {
        if (!stock.lastUpdated) {
            return 'Never';
        }

        const lastUpdated = new Date(stock.lastUpdated);
        const now = new Date();
        const diffMs = now - lastUpdated;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffMins < 1440) {
            return `${Math.floor(diffMins / 60)}h ago`;
        } else {
            return lastUpdated.toLocaleDateString();
        }
    }

    /**
     * Update market status display
     */
    updateMarketStatus() {
        const status = this.api.getMarketStatus();
        const statusText = status.isOpen ? 'Market Open' : 'Market Closed';
        
        // Update page title or add status indicator if needed
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
            if (status.isOpen && this.storage.getAllStocks().length > 0) {
                console.log('Auto-refreshing stock prices...');
                this.handleRefreshAll();
            }
        }, this.autoRefreshIntervalMs);
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
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
                max-width: 300px;
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

        // Auto-hide after 3 seconds
        setTimeout(() => {
            messageEl.style.opacity = '0';
            setTimeout(() => {
                messageEl.style.display = 'none';
                messageEl.style.opacity = '1';
            }, 300);
        }, 3000);
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new StockTrackerApp();
});