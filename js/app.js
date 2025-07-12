/**
 * Main Application Logic for Stock Tracker
 * Optimized for efficient Finnhub API usage
 */

class StockTrackerApp {
    constructor() {
        this.storage = window.stockStorage;
        this.api = window.stockAPI;
        this.refreshInterval = null;
        this.autoRefreshEnabled = false;
        this.autoRefreshIntervalMs = 30 * 60 * 1000; // 30 minutes (more conservative)
        this.statusSortActive = false;
        this.statusSortOrder = 'asc';
        this.lastFullRefresh = this.loadLastFullRefresh();

        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        if (!this.storage.isLocalStorageAvailable()) {
            this.showMessage('LocalStorage not available. Data will not persist.', 'warning');
        }

        // Reset all stocks' loading state to false on startup
        const stocks = this.storage.getAllStocks();
        stocks.forEach(stock => {
            if (stock.loading) {
                this.storage.updateStock(stock.symbol, { loading: false });
            }
        });

        this.setupEventListeners();
        this.renderStocks();
        this.updateMarketStatus();
        this.showStorageInfo();
        this.showQuotaStatus(); // NEW: Show API quota status
        
        // More conservative auto-refresh
        this.startSmartAutoRefresh();
        
        console.log('Stock Tracker App initialized with API optimization');
        console.log('Storage stats:', this.storage.getStats());
        console.log('API quota:', this.api.getQuotaStatus());
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

        // Refresh all button with quota check
        const refreshAllBtn = document.getElementById('refreshAllBtn');
        refreshAllBtn.addEventListener('click', () => {
            this.handleRefreshAllWithQuotaCheck();
        });

        // Export and import buttons
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.addEventListener('click', () => {
            this.handleExport();
        });

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
                        this.handleRefreshAllWithQuotaCheck();
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
            
            if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
                e.preventDefault();
                this.handleClearAllData();
            }
        });

        // Handle page visibility change for smart refresh
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.checkAndSmartRefresh();
            }
        });

        // Before unload warning
        window.addEventListener('beforeunload', (e) => {
            const stats = this.storage.getStats();
            const lastBackup = this.storage.settings.lastBackup;
            
            if (stats.totalStocks > 0 && (!lastBackup || 
                new Date() - new Date(lastBackup) > 7 * 24 * 60 * 60 * 1000)) {
                e.preventDefault();
                e.returnValue = 'You have unsaved stock data. Consider exporting your data before leaving.';
            }
        });
    }

    /**
     * Handle adding a new stock with quota check
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

        if (this.storage.getStock(symbol)) {
            this.showMessage(`${symbol} already exists in your portfolio`, 'error');
            symbolInput.focus();
            return;
        }

        // NEW: Check API quota before adding
        const quotaStatus = this.api.getQuotaStatus();
        if (!quotaStatus.canMakeRequest) {
            this.showMessage(`Daily API quota exceeded (${quotaStatus.used}/${quotaStatus.limit}). Try again tomorrow.`, 'error');
            return;
        }

        this.setFormDisabled(true);
        addBtn.textContent = 'Adding...';

        try {
            // Add to storage first
            const added = this.storage.addStock({ symbol, targetPrice });
            
            if (!added) {
                throw new Error('Failed to add stock to storage');
            }

            this.renderStocks();

            // Fetch price data
            await this.updateStockPrice(symbol);

            symbolInput.value = '';
            targetInput.value = '';
            
            // NEW: Show quota status after adding
            const newQuotaStatus = this.api.getQuotaStatus();
            this.showMessage(
                `${symbol} added successfully! (${newQuotaStatus.used}/${newQuotaStatus.limit} API calls used today)`, 
                'success'
            );
            
            symbolInput.focus();
        } catch (error) {
            console.error('Error adding stock:', error);
            this.storage.removeStock(symbol);
            this.showMessage(`Error adding ${symbol}: ${error.message}`, 'error');
        } finally {
            this.setFormDisabled(false);
            addBtn.textContent = 'Add Stock';
            this.renderStocks();
            this.showQuotaStatus(); // Update quota display
        }
    }

    /**
     * NEW: Handle refreshing all stocks with quota check
     */
    async handleRefreshAllWithQuotaCheck() {
        const stocks = this.storage.getAllStocks();
        
        if (stocks.length === 0) {
            this.showMessage('No stocks to refresh', 'info');
            return;
        }

        const quotaStatus = this.api.getQuotaStatus();
        
        // Warn user if they don't have enough quota
        if (quotaStatus.remaining < stocks.length) {
            const proceed = confirm(
                `⚠️ API Quota Warning\n\n` +
                `You have ${quotaStatus.remaining} API calls remaining today.\n` +
                `Refreshing ${stocks.length} stocks will use ${stocks.length} calls.\n\n` +
                `This will ${quotaStatus.remaining < stocks.length ? 'exceed your daily limit' : 'use most of your quota'}.\n\n` +
                `Continue anyway? (Only first ${quotaStatus.remaining} stocks will be updated)`
            );
            
            if (!proceed) {
                return;
            }
        }

        await this.handleRefreshAll();
    }

    /**
     * NEW: Smart refresh - only refresh if data is stale and we have quota
     */
    checkAndSmartRefresh() {
        const quotaStatus = this.api.getQuotaStatus();
        
        // Don't auto-refresh if quota is low
        if (quotaStatus.remaining < 5) {
            console.log('⚠️ Skipping auto-refresh due to low quota');
            return;
        }

        const stocks = this.storage.getAllStocks();
        const staleThreshold = 60 * 60 * 1000; // 1 hour for smart refresh
        const now = new Date();

        const staleStocks = stocks.filter(stock => {
            if (!stock.lastUpdated) return true;
            return now - new Date(stock.lastUpdated) > staleThreshold;
        });

        // Only refresh if we have stale data and sufficient quota
        if (staleStocks.length > 0 && staleStocks.length <= quotaStatus.remaining) {
            console.log(`📱 Smart refresh: ${staleStocks.length} stale stocks, ${quotaStatus.remaining} quota remaining`);
            this.handleRefreshAll();
        }
    }

    /**
     * Handle refreshing all stock prices (UPDATED for new API)
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

        // Set all stocks to loading state
        stocks.forEach(stock => {
            this.storage.updateStock(stock.symbol, { loading: true, error: null });
        });
        this.renderStocks();

        let successCount = 0;
        let errorCount = 0;
        let quotaExceededCount = 0;

        try {
            const symbols = stocks.map(s => s.symbol);
            
            // NEW: Use optimized batch fetch with progress tracking
            const results = await this.api.batchFetch(symbols, (progress) => {
                refreshBtn.textContent = `Refreshing... ${progress.percentage}% (${progress.quotaUsed}/${progress.quotaLimit} quota)`;
            });

            // Process results
            for (const result of results) {
                if (result.success) {
                    this.storage.updateStock(result.symbol, {
                        currentPrice: result.price,
                        change: result.change,
                        changePercent: result.changePercent,
                        loading: false,
                        error: null
                    });
                    successCount++;
                } else {
                    this.storage.updateStock(result.symbol, {
                        loading: false,
                        error: result.error
                    });
                    
                    if (result.error.includes('quota')) {
                        quotaExceededCount++;
                    } else {
                        errorCount++;
                    }
                }
            }

            // Save last refresh time
            this.saveLastFullRefresh();

            // NEW: Show results with quota info
            const quotaStatus = this.api.getQuotaStatus();
            let message = '';
            
            if (quotaExceededCount > 0) {
                message = `⚠️ ${successCount} stocks refreshed, ${quotaExceededCount} skipped (quota limit), ${errorCount} failed`;
            } else if (errorCount === 0) {
                message = `✅ All ${successCount} stocks refreshed! (${quotaStatus.used}/${quotaStatus.limit} quota used)`;
            } else {
                message = `⚠️ ${successCount} stocks refreshed, ${errorCount} failed (${quotaStatus.used}/${quotaStatus.limit} quota used)`;
            }
            
            this.showMessage(message, errorCount === 0 ? 'success' : 'warning');
        } catch (error) {
            console.error('Error refreshing stocks:', error);
            this.showMessage('Error occurred while refreshing stocks', 'error');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = originalText;
            this.renderStocks();
            this.showQuotaStatus(); // Update quota display
        }
    }

    /**
     * Update price for a specific stock (SAME as before - no changes needed)
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
     * NEW: Show current API quota status
     */
    showQuotaStatus() {
        const quotaStatus = this.api.getQuotaStatus();
        let quotaElement = document.getElementById('quotaStatus');
        
        if (!quotaElement) {
            // Create quota status element
            quotaElement = document.createElement('div');
            quotaElement.id = 'quotaStatus';
            quotaElement.style.cssText = `
                text-align: center;
                padding: 8px;
                margin: 10px 0;
                border-radius: 6px;
                font-size: 0.9rem;
                font-weight: 500;
            `;
            
            // Insert after the header
            const header = document.querySelector('header');
            if (header) {
                header.parentNode.insertBefore(quotaElement, header.nextSibling);
            }
        }
        
        // Update content and styling based on quota level
        quotaElement.textContent = `API Quota: ${quotaStatus.used}/${quotaStatus.limit} used today (${quotaStatus.remaining} remaining)`;
        
        if (quotaStatus.remaining < 5) {
            quotaElement.style.background = '#f8d7da';
            quotaElement.style.color = '#721c24';
            quotaElement.style.border = '1px solid #f5c6cb';
        } else if (quotaStatus.remaining < 15) {
            quotaElement.style.background = '#fff3cd';
            quotaElement.style.color = '#856404';
            quotaElement.style.border = '1px solid #ffeaa7';
        } else {
            quotaElement.style.background = '#d1ecf1';
            quotaElement.style.color = '#0c5460';
            quotaElement.style.border = '1px solid #bee5eb';
        }
    }

    /**
     * NEW: Start smart auto-refresh with quota awareness
     */
    startSmartAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(() => {
            const status = this.api.getMarketStatus();
            const quotaStatus = this.api.getQuotaStatus();
            const stocks = this.storage.getAllStocks();
            
            // Only auto-refresh if:
            // 1. Market is open
            // 2. We have stocks
            // 3. We have sufficient API quota (at least 10 calls remaining)
            // 4. It's been at least 30 minutes since last refresh
            const timeSinceLastRefresh = Date.now() - this.lastFullRefresh;
            const shouldRefresh = status.isOpen && 
                                stocks.length > 0 && 
                                quotaStatus.remaining >= Math.min(10, stocks.length) &&
                                timeSinceLastRefresh > this.autoRefreshIntervalMs;
            
            if (shouldRefresh) {
                console.log('🔄 Smart auto-refresh triggered');
                this.handleRefreshAll();
            }
            
            this.updateMarketStatus();
            this.showQuotaStatus(); // Update quota display regularly
        }, this.autoRefreshIntervalMs);

        console.log(`📱 Smart auto-refresh enabled (every ${this.autoRefreshIntervalMs / 60000} minutes, quota-aware)`);
    }

    /**
     * NEW: Load/save last full refresh timestamp
     */
    loadLastFullRefresh() {
        try {
            return parseInt(localStorage.getItem('last_full_refresh') || '0');
        } catch {
            return 0;
        }
    }

    saveLastFullRefresh() {
        try {
            const now = Date.now();
            localStorage.setItem('last_full_refresh', now.toString());
            this.lastFullRefresh = now;
        } catch (error) {
            console.error('Failed to save last refresh time:', error);
        }
    }

    // ALL OTHER METHODS REMAIN THE SAME (no changes needed)
    // handleRemoveStock, handleClearAllData, handleUpdateTargetPrice, 
    // handleExport, handleImport, showStorageInfo, renderStocks, etc.

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
                    this.handleRefreshAllWithQuotaCheck();
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

        // Sort stocks by status if requested
        let sortedStocks = [...stocks];
        if (this.statusSortActive) {
            sortedStocks.sort((a, b) => {
                // Calculate percent difference for each stock
                const getPercentDiff = stock => {
                    if (!stock.targetPrice || stock.currentPrice === null) {
                        // Place missing data at top for asc, bottom for desc
                        return this.statusSortOrder === 'asc' ? -Infinity : Infinity;
                    }
                    const diff = stock.currentPrice - stock.targetPrice;
                    return (diff / stock.targetPrice) * 100;
                };
                const percentA = getPercentDiff(a);
                const percentB = getPercentDiff(b);
                if (this.statusSortOrder === 'asc') {
                    return percentA - percentB;
                } else {
                    return percentB - percentA;
                }
            });
        } else {
            sortedStocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
        }

        const arrow = this.statusSortOrder === 'asc' ? '▲' : '▼';
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
                        <th>Status <button id="statusSortBtn" style="background:none;border:none;cursor:pointer;font-size:1em;vertical-align:middle;" title="Sort by Status">${arrow}</button></th>
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

        // Add event listener for sort button
        const sortBtn = document.getElementById('statusSortBtn');
        if (sortBtn) {
            sortBtn.onclick = () => {
                this.statusSortActive = true;
                this.statusSortOrder = this.statusSortOrder === 'asc' ? 'desc' : 'asc';
                this.renderStocks();
            };
        }
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
            apiQuota: this.api.getQuotaStatus(), // NEW
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
    console.log('📊 App stats available via getAppStats()');
    
    // NEW: Add test button for development (remove in production)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const testBtn = document.createElement('button');
        testBtn.textContent = '🧪 Test Single Stock';
        testBtn.style.cssText = 'position: fixed; top: 10px; left: 10px; z-index: 1001; padding: 8px; background: orange; color: white; border: none; border-radius: 4px; font-size: 12px;';
        testBtn.onclick = async () => {
            console.log('🧪 Testing single stock...');
            console.log('Quota before:', window.stockAPI.getQuotaStatus());
            
            const result = await window.stockAPI.fetchStockPrice('AAPL');
            console.log('Result:', result);
            console.log('Quota after:', window.stockAPI.getQuotaStatus());
            
            // Test cache
            console.log('🔄 Testing cache...');
            const cachedResult = await window.stockAPI.fetchStockPrice('AAPL');
            console.log('Cached result (should show "Using cached data"):', cachedResult);
            console.log('Cache stats:', window.stockAPI.getCacheStats());
        };
        document.body.appendChild(testBtn);
    }
});