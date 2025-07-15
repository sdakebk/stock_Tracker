/**
 * Data Storage Management for Stock Tracker
 * Handles persistent storage of stock data and user preferences using localStorage
 */

// Firebase Storage Management for Stock Tracker
// Handles persistent storage of stock data using Firebase Firestore

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDOMNbemeBv-Dc6P1LuxE9bsszQuRH6HUo",
  authDomain: "abovebelow-2025.firebaseapp.com",
  projectId: "abovebelow-2025",
  storageBucket: "abovebelow-2025.firebasestorage.app",
  messagingSenderId: "502398959856",
  appId: "1:502398959856:web:04646fa5d44d83fd294235",
  measurementId: "G-1ZEPKBTGH9"
};

// Initialize Firebase if not already initialized
if (typeof firebase === 'undefined') {
  throw new Error('Firebase SDK not loaded');
}
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

class StockStorage {
  constructor() {
    this.db = firebase.firestore();
    this.auth = firebase.auth();
    this.userId = null;
    this.stocks = [];
    this.settings = this.getDefaultSettings();
    this.isInitialized = false;
    this.init();
  }

  async init() {
    try {
      // Sign in anonymously
      const result = await this.auth.signInAnonymously();
      this.userId = result.user.uid;
      await this.loadStocks();
      await this.loadSettings();
      this.isInitialized = true;
      console.log('🔥 Firebase initialized and user signed in:', this.userId);
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error);
    }
  }

  getUserDocPath(collection) {
    return `users/${this.userId}/${collection}`;
  }

  getDefaultSettings() {
    return {
      autoRefresh: true,
      refreshInterval: 5,
      currency: 'USD',
      theme: 'light',
      notifications: true
    };
  }

  async loadStocks() {
    if (!this.userId) return [];
    try {
      const stocksRef = this.db.collection(this.getUserDocPath('stocks'));
      const snapshot = await stocksRef.get();
      this.stocks = [];
      snapshot.forEach(doc => {
        this.stocks.push({ id: doc.id, ...doc.data() });
      });
      console.log(`📊 Loaded ${this.stocks.length} stocks from Firebase`);
      return this.stocks;
    } catch (error) {
      console.error('Error loading stocks from Firebase:', error);
      return [];
    }
  }

  async loadSettings() {
    if (!this.userId) return this.getDefaultSettings();
    try {
      const settingsRef = this.db.doc(`${this.getUserDocPath('settings')}/user_settings`);
      const doc = await settingsRef.get();
      if (doc.exists) {
        this.settings = { ...this.getDefaultSettings(), ...doc.data() };
      } else {
        this.settings = this.getDefaultSettings();
      }
      return this.settings;
    } catch (error) {
      console.error('Error loading settings from Firebase:', error);
      return this.getDefaultSettings();
    }
  }

  async saveStocks(stocks) {
    if (!this.userId) return;
    try {
      this.stocks = stocks;
      // Use batch write for better performance
      const batch = this.db.batch();
      const stocksRef = this.db.collection(this.getUserDocPath('stocks'));
      // Delete existing stocks first
      const existingSnapshot = await stocksRef.get();
      existingSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      // Add new stocks
      stocks.forEach(stock => {
        const docRef = stocksRef.doc(stock.id || this.generateId());
        batch.set(docRef, {
          symbol: stock.symbol,
          targetPrice: stock.targetPrice,
          currentPrice: stock.currentPrice,
          change: stock.change,
          changePercent: stock.changePercent,
          lastUpdated: stock.lastUpdated,
          dateAdded: stock.dateAdded,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      console.log(`🔥 Saved ${stocks.length} stocks to Firebase`);
    } catch (error) {
      console.error('Error saving stocks to Firebase:', error);
    }
  }

  async saveSettings(settings) {
    if (!this.userId) return;
    try {
      this.settings = { ...this.settings, ...settings };
      const settingsRef = this.db.doc(`${this.getUserDocPath('settings')}/user_settings`);
      await settingsRef.set({
        ...this.settings,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('🔥 Settings saved to Firebase');
    } catch (error) {
      console.error('Error saving settings to Firebase:', error);
    }
  }

  async addStock(stock) {
    if (!this.userId) return false;
    try {
      // Check if stock already exists
      await this.loadStocks();
      if (this.stocks.find(s => s.symbol === stock.symbol)) {
        throw new Error('Stock already exists');
      }
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
      await this.saveStocks(this.stocks);
      return true;
    } catch (error) {
      console.error('Error adding stock:', error);
      return false;
    }
  }

  async removeStock(symbol) {
    if (!this.userId) return false;
    try {
      await this.loadStocks();
      const initialLength = this.stocks.length;
      this.stocks = this.stocks.filter(stock => stock.symbol !== symbol);
      if (this.stocks.length < initialLength) {
        await this.saveStocks(this.stocks);
        console.log(`Removed stock: ${symbol}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error removing stock:', error);
      return false;
    }
  }

  async updateStock(symbol, data) {
    if (!this.userId) return false;
    try {
      await this.loadStocks();
      const stockIndex = this.stocks.findIndex(s => s.symbol === symbol);
      if (stockIndex === -1) {
        return false;
      }
      this.stocks[stockIndex] = {
        ...this.stocks[stockIndex],
        ...data,
        lastUpdated: new Date().toISOString()
      };
      await this.saveStocks(this.stocks);
      return true;
    } catch (error) {
      console.error('Error updating stock:', error);
      return false;
    }
  }

  async updateTargetPrice(symbol, targetPrice) {
    return this.updateStock(symbol, { targetPrice });
  }

  async getAllStocks() {
    await this.loadStocks();
    return [...this.stocks];
  }

  async getStock(symbol) {
    await this.loadStocks();
    return this.stocks.find(s => s.symbol === symbol) || null;
  }

  async clearAllStocks() {
    if (!this.userId) return false;
    try {
      this.stocks = [];
      await this.saveStocks(this.stocks);
      console.log('All stocks cleared');
      return true;
    } catch (error) {
      console.error('Error clearing stocks:', error);
      return false;
    }
  }

  async clearStorage() {
    if (!this.userId) return;
    try {
      // Delete all stocks
      const stocksRef = this.db.collection(this.getUserDocPath('stocks'));
      const snapshot = await stocksRef.get();
      const batch = this.db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      // Delete settings
      const settingsRef = this.db.doc(`${this.getUserDocPath('settings')}/user_settings`);
      await settingsRef.delete();
      this.stocks = [];
      this.settings = this.getDefaultSettings();
      console.log('Firebase storage cleared');
    } catch (error) {
      console.error('Error clearing Firebase storage:', error);
    }
  }

  async exportData() {
    try {
      await this.loadStocks();
      await this.loadSettings();
      const exportData = {
        stocks: this.stocks,
        settings: this.settings,
        exportDate: new Date().toISOString(),
        version: '2.0',
        appName: 'Stock Tracker Pro - Firebase'
      };
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Error exporting data:', error);
      return null;
    }
  }

  async importData(jsonData, merge = false) {
    try {
      const data = JSON.parse(jsonData);
      if (!data.stocks || !Array.isArray(data.stocks)) {
        throw new Error('Invalid data format - missing stocks array');
      }
      const validStocks = data.stocks.filter(stock => {
        return stock.symbol && typeof stock.symbol === 'string';
      });
      if (validStocks.length === 0) {
        throw new Error('No valid stocks found in import data');
      }
      await this.loadStocks();
      if (merge) {
        const existingSymbols = this.stocks.map(s => s.symbol);
        const newStocks = validStocks.filter(s => !existingSymbols.includes(s.symbol));
        this.stocks = [...this.stocks, ...newStocks];
        console.log(`Merged ${newStocks.length} new stocks`);
      } else {
        this.stocks = validStocks;
        console.log(`Replaced all stocks with ${validStocks.length} imported stocks`);
      }
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
      if (data.settings && typeof data.settings === 'object') {
        this.settings = { ...this.getDefaultSettings(), ...data.settings };
        await this.saveSettings(this.settings);
      }
      await this.saveStocks(this.stocks);
      return true;
    } catch (error) {
      console.error('Error importing data:', error);
      return false;
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async getStats() {
    await this.loadStocks();
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
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
      storageType: 'Firebase',
      userId: this.userId,
      lastExport: this.settings.lastExport || 'Never'
    };
  }

  async getStorageQuota() {
    // Firestore has generous free tier, so just return a static message
    return {
      type: 'Firebase',
      used: 'Calculating...',
      available: 'Generous free tier',
      note: 'Firebase provides much larger storage capacity'
    };
  }
}

// Create global storage instance
window.stockStorage = new StockStorage();