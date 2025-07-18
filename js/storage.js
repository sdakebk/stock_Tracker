/**
 * Firebase Storage Management for Stock Tracker
 * Handles persistent storage with proper user authentication
 */

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
    this.user = null;
    this.stocks = [];
    this.settings = this.getDefaultSettings();
    this.isInitialized = false;
    this.authStateListeners = [];
    this.init();
  }

  async init() {
    try {
      // Set up auth state listener
      this.auth.onAuthStateChanged((user) => {
        if (user) {
          this.userId = user.uid;
          this.user = user;
          this.onUserSignedIn();
        } else {
          this.userId = null;
          this.user = null;
          this.onUserSignedOut();
        }
        // Notify listeners
        this.authStateListeners.forEach(listener => listener(user));
      });
      
      console.log('🔥 Firebase initialized and auth listener set up');
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error);
    }
  }

  // Authentication State Management
  onAuthStateChanged(callback) {
    this.authStateListeners.push(callback);
    // Call immediately with current user
    callback(this.user);
  }

  async onUserSignedIn() {
    try {
      await this.loadStocks();
      await this.loadSettings();
      this.isInitialized = true;
      console.log('✅ User signed in and data loaded:', this.userId);
    } catch (error) {
      console.error('❌ Error loading user data:', error);
    }
  }

  onUserSignedOut() {
    this.stocks = [];
    this.settings = this.getDefaultSettings();
    this.isInitialized = false;
    console.log('👋 User signed out and data cleared');
  }

  // Authentication Methods
  async signInWithEmail(email, password) {
    try {
      const result = await this.auth.signInWithEmailAndPassword(email, password);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('❌ Sign in failed:', error);
      return { success: false, error: this.getAuthErrorMessage(error) };
    }
  }

  async signUpWithEmail(email, password, displayName = null) {
    try {
      const result = await this.auth.createUserWithEmailAndPassword(email, password);
      
      // Update display name if provided
      if (displayName) {
        await result.user.updateProfile({ displayName });
      }
      
      // Create user profile document
      await this.createUserProfile(result.user);
      
      return { success: true, user: result.user };
    } catch (error) {
      console.error('❌ Sign up failed:', error);
      return { success: false, error: this.getAuthErrorMessage(error) };
    }
  }

  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await this.auth.signInWithPopup(provider);
      
      // Create user profile if first time
      await this.createUserProfile(result.user);
      
      return { success: true, user: result.user };
    } catch (error) {
      console.error('❌ Google sign in failed:', error);
      return { success: false, error: this.getAuthErrorMessage(error) };
    }
  }

  async signOut() {
    try {
      await this.auth.signOut();
      return { success: true };
    } catch (error) {
      console.error('❌ Sign out failed:', error);
      return { success: false, error: error.message };
    }
  }

  async resetPassword(email) {
    try {
      await this.auth.sendPasswordResetEmail(email);
      return { success: true };
    } catch (error) {
      console.error('❌ Password reset failed:', error);
      return { success: false, error: this.getAuthErrorMessage(error) };
    }
  }

  async updateProfile(displayName, photoURL = null) {
    try {
      if (!this.user) throw new Error('No user signed in');
      
      const updates = { displayName };
      if (photoURL) updates.photoURL = photoURL;
      
      await this.user.updateProfile(updates);
      await this.updateUserProfile({ displayName, photoURL });
      
      return { success: true };
    } catch (error) {
      console.error('❌ Profile update failed:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteAccount() {
    try {
      if (!this.user) throw new Error('No user signed in');
      
      // Delete all user data first
      await this.clearStorage();
      
      // Delete user profile
      await this.db.doc(`users/${this.userId}`).delete();
      
      // Delete the user account
      await this.user.delete();
      
      return { success: true };
    } catch (error) {
      console.error('❌ Account deletion failed:', error);
      return { success: false, error: error.message };
    }
  }

  // User Profile Management
  async createUserProfile(user) {
    try {
      const userRef = this.db.doc(`users/${user.uid}`);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        await userRef.set({
          displayName: user.displayName || null,
          email: user.email,
          photoURL: user.photoURL || null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
          provider: user.providerData[0]?.providerId || 'unknown'
        });
        console.log('👤 User profile created');
      } else {
        // Update last sign in
        await userRef.update({
          lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (error) {
      console.error('❌ Error creating user profile:', error);
    }
  }

  async updateUserProfile(data) {
    try {
      if (!this.userId) return;
      
      const userRef = this.db.doc(`users/${this.userId}`);
      await userRef.update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('❌ Error updating user profile:', error);
    }
  }

  async getUserProfile() {
    try {
      if (!this.userId) return null;
      
      const userRef = this.db.doc(`users/${this.userId}`);
      const doc = await userRef.get();
      
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('❌ Error getting user profile:', error);
      return null;
    }
  }

  // Helper Methods
  getAuthErrorMessage(error) {
    switch (error.code) {
      case 'auth/user-not-found':
        return 'No account found with this email address.';
      case 'auth/wrong-password':
        return 'Incorrect password.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please try again later.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection.';
      default:
        return error.message || 'An error occurred during authentication.';
    }
  }

  isSignedIn() {
    return !!this.user;
  }

  getCurrentUser() {
    return this.user;
  }

  requireAuth() {
    if (!this.isSignedIn()) {
      throw new Error('Authentication required');
    }
  }

  // Data Storage Methods (with auth checks)
  getUserDocPath(collection) {
    this.requireAuth();
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
    this.requireAuth();
    try {
      this.stocks = stocks;
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
    this.requireAuth();
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
    this.requireAuth();
    try {
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
    this.requireAuth();
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
    this.requireAuth();
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
    this.requireAuth();
    await this.loadStocks();
    return [...this.stocks];
  }

  async getStock(symbol) {
    this.requireAuth();
    await this.loadStocks();
    return this.stocks.find(s => s.symbol === symbol) || null;
  }

  async clearAllStocks() {
    this.requireAuth();
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
    this.requireAuth();
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
    this.requireAuth();
    try {
      await this.loadStocks();
      await this.loadSettings();
      const exportData = {
        stocks: this.stocks,
        settings: this.settings,
        exportDate: new Date().toISOString(),
        version: '2.0',
        appName: 'Stock Tracker Pro - Firebase Auth'
      };
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Error exporting data:', error);
      return null;
    }
  }

  async importData(jsonData, merge = false) {
    this.requireAuth();
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
    this.requireAuth();
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
      storageType: 'Firebase with Auth',
      userId: this.userId,
      userEmail: this.user?.email || 'Unknown',
      lastExport: this.settings.lastExport || 'Never'
    };
  }

  async getStorageQuota() {
    return {
      type: 'Firebase with Authentication',
      used: 'Calculating...',
      available: 'Generous free tier',
      note: 'Firebase provides secure, per-user storage with authentication'
    };
  }
}

// Create global storage instance
window.stockStorage = new StockStorage();