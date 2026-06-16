import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, getDoc, addDoc, doc, updateDoc, increment, serverTimestamp, onSnapshot, orderBy, limit, getDocsFromCache, getDocFromCache } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfile, Product, Stall, Order, CartItem } from '../types';
import { handleFirestoreError, OperationType } from '@/lib/error-handler';
import { QrCode, ShoppingCart, Users, LogOut, Plus, Minus, Trash2, Store, Clock, PackageCheck, Loader2, Search, ChevronLeft, ChevronRight, BarChart3, TrendingUp, Package, Zap, ChevronDown, ChevronUp, Wifi, WifiOff, Receipt, CheckCircle2, UserCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

import QRScanner from './QRScanner';

export default function VendorDashboard({ 
  profile,
  externalCart,
  setExternalCart,
  externalScannedUser,
  setExternalScannedUser
}: { 
  profile: UserProfile,
  externalCart?: CartItem[],
  setExternalCart?: React.Dispatch<React.SetStateAction<CartItem[]>>,
  externalScannedUser?: UserProfile | null,
  setExternalScannedUser?: React.Dispatch<React.SetStateAction<UserProfile | null>>
}) {
  const [activeStallId, setActiveStallId] = useState<string | null>(profile.vendorIds?.[0] || null);
  const [availableStalls, setAvailableStalls] = useState<Stall[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stall, setStall] = useState<Stall | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'pos' | 'orders' | 'analytics'>('pos');
  
  // State management: Use external if provided, otherwise internal
  const [internalCart, setInternalCart] = useState<CartItem[]>([]);
  const cart = externalCart !== undefined ? externalCart : internalCart;
  const setCart = setExternalCart !== undefined ? setExternalCart : setInternalCart;

  const [internalScannedUser, setInternalScannedUser] = useState<UserProfile | null>(null);
  const baseScannedUser = externalScannedUser !== undefined ? externalScannedUser : internalScannedUser;
  const setScannedUser = setExternalScannedUser !== undefined ? setExternalScannedUser : setInternalScannedUser;

  const [liveScannedUser, setLiveScannedUser] = useState<UserProfile | null>(null);
  const [liveParentUser, setLiveParentUser] = useState<UserProfile | null>(null);

  // Real-time synchronization for the scanned user
  useEffect(() => {
    if (!baseScannedUser?.uid) {
      setLiveScannedUser(null);
      return;
    }

    const unsubUser = onSnapshot(doc(db, 'users', baseScannedUser.uid), (snap) => {
      if (snap.exists()) {
        setLiveScannedUser({ ...snap.data(), uid: snap.id } as UserProfile);
      } else {
        setLiveScannedUser(null);
      }
    }, (err) => {
      console.error("Error listening to scanned user:", err);
    });

    return () => {
      unsubUser();
    };
  }, [baseScannedUser?.uid]);

  // Real-time synchronization for the parent if the user is a dependent with shared balance
  useEffect(() => {
    if (!liveScannedUser) {
      setLiveParentUser(null);
      return;
    }

    const isShared = (!liveScannedUser.balanceType || liveScannedUser.balanceType === 'shared') && liveScannedUser.parentUid;
    if (!isShared) {
      setLiveParentUser(null);
      return;
    }

    const parentUid = liveScannedUser.parentUid!;
    const unsubParent = onSnapshot(doc(db, 'users', parentUid), (snap) => {
      if (snap.exists()) {
        setLiveParentUser({ ...snap.data(), uid: snap.id } as UserProfile);
      } else {
        setLiveParentUser(null);
      }
    }, (err) => {
      console.error("Error listening to parent user:", err);
    });

    return () => {
      unsubParent();
    };
  }, [liveScannedUser?.uid, liveScannedUser?.parentUid, liveScannedUser?.balanceType]);

  // Compute scannedUser dynamically and reactively with resolved shared balance
  const scannedUser = useMemo(() => {
    if (!liveScannedUser) return null;
    const isShared = (!liveScannedUser.balanceType || liveScannedUser.balanceType === 'shared') && liveScannedUser.parentUid;
    
    if (isShared && liveParentUser) {
      return {
        ...liveScannedUser,
        balance: liveParentUser.balance || 0
      };
    }
    return liveScannedUser;
  }, [liveScannedUser, liveParentUser]);

  // Formatter matching online card (16 numbers with spaces every 4 digits)
  const formatCardNumber = (str: string) => {
    if (!str) return '';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const numeric = Math.abs(hash).toString().padEnd(16, '0').substring(0, 16);
    return numeric.replace(/(.{4})/g, '$1 ').trim();
  };

  const [showMobileCart, setShowMobileCart] = useState(false);
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [statusModal, setStatusModal] = useState<{
    show: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
    items?: CartItem[];
  }>({
    show: false,
    type: 'info',
    title: '',
    message: ''
  });

  // Monitor connection status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // POS View State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Analytics State
  const [stats, setStats] = useState({ 
    totalRevenue: 0, 
    totalItems: 0, 
    productSales: {} as Record<string, { count: number; revenue: number; name: string }> 
  });
  const [statsLoading, setStatsLoading] = useState(false);
  const [lastSale, setLastSale] = useState<{
    userName: string;
    total: number;
    items: string[];
    timestamp: Date;
  } | null>(null);

  const [posSales, setPosSales] = useState<any[]>([]);
  const [deliveredDigitalOrders, setDeliveredDigitalOrders] = useState<any[]>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [ordersSubTab, setOrdersSubTab] = useState<'pending' | 'history'>('pending');

  const allPreviousOrders = useMemo(() => {
    const combined = [...posSales, ...deliveredDigitalOrders];
    return combined.sort((a, b) => {
      const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
      const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
      return timeB - timeA;
    });
  }, [posSales, deliveredDigitalOrders]);

  const filteredPreviousOrders = useMemo(() => {
    return allPreviousOrders.filter(order => {
      const queryStr = historySearchQuery.toLowerCase().trim();
      if (!queryStr) return true;
      
      const clientMatch = order.clientName.toLowerCase().includes(queryStr);
      const cardMatch = order.cardNumber?.toLowerCase().includes(queryStr) || formatCardNumber(order.cardNumber || '').toLowerCase().includes(queryStr);
      const itemsMatch = order.items.some((item: string) => item.toLowerCase().includes(queryStr));
      const idMatch = order.id.toLowerCase().includes(queryStr);
      
      return clientMatch || cardMatch || itemsMatch || idMatch;
    });
  }, [allPreviousOrders, historySearchQuery]);

  useEffect(() => {
    if (profile.role === 'admin') {
      const unsub = onSnapshot(collection(db, 'stalls'), (snap) => {
        setAvailableStalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as Stall)));
      });
      return () => unsub();
    } else if (profile.vendorIds && profile.vendorIds.length > 0) {
      const q = query(collection(db, 'stalls'), where('__name__', 'in', profile.vendorIds));
      const unsub = onSnapshot(q, (snap) => {
        setAvailableStalls(snap.docs.map(d => ({ id: d.id, ...d.data() } as Stall)));
      });
      return () => unsub();
    }
  }, [profile.vendorIds, profile.role]);

  useEffect(() => {
    if (profile.role === 'admin' && availableStalls.length > 0 && !activeStallId) {
      setActiveStallId(availableStalls[0].id);
    }
  }, [availableStalls, profile.role, activeStallId]);

  useEffect(() => {
    if (!activeStallId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Fetch Stall Info
    const stallRef = doc(collection(db, 'stalls'), activeStallId);
    const unsubStall = onSnapshot(stallRef, (snap) => {
      if (snap.exists()) {
        setStall({ id: snap.id, ...snap.data() } as Stall);
      }
    });

    // Fetch Products for this Stall
    const qP = query(collection(db, 'products'), where('vendorId', '==', activeStallId), where('active', '==', true));
    const unsubProducts = onSnapshot(qP, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      setLoading(false);
    });

    // Fetch Digital Orders
    const qO = query(
      collection(db, 'orders'), 
      where('stallId', '==', activeStallId)
    );
    const unsubOrders = onSnapshot(qO, (snap) => {
      const allOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      
      // Filter out pending ones
      const pendingOrders = allOrders.filter(o => o.status === 'pending');
      // Sort on client side to avoid composite index requirement
      const sortedOrders = pendingOrders.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
        return timeA - timeB; // Oldest first for delivery queue
      });
      setOrders(sortedOrders);

      // Filter out completed / delivered/ cancelled ones
      const completedOrders = allOrders.filter(o => o.status !== 'pending').map(order => ({
        id: order.id,
        type: 'digital',
        clientName: order.studentName || 'Cliente anônimo',
        items: order.items || [],
        total: order.total || 0,
        cardNumber: '',
        timestamp: order.timestamp,
        status: order.status
      }));
      setDeliveredDigitalOrders(completedOrders);
    });

    // Fetch POS Sales (consumption)
    const qC = query(
      collection(db, 'consumption'),
      where('stallId', '==', activeStallId)
    );
    const unsubConsumption = onSnapshot(qC, (snap) => {
      const sales = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          type: 'pdv',
          clientName: data.clientName || data.studentName || 'Cliente anônimo',
          items: data.items || [],
          total: data.amount || 0,
          cardNumber: data.cardNumber || '',
          timestamp: data.timestamp,
          status: 'completed'
        };
      });
      setPosSales(sales);
    });

    return () => {
      unsubStall();
      unsubProducts();
      unsubOrders();
      unsubConsumption();
    };
  }, [activeStallId]);

  // Analytics Aggregation
  useEffect(() => {
    if (activeTab !== 'analytics' || !activeStallId) return;

    setStatsLoading(true);
    const q = query(collection(db, 'consumption'), where('stallId', '==', activeStallId), limit(1000));
    
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs;
      // Sort manually to avoid index requirement
      docs.sort((a, b) => {
        const timeA = a.data().timestamp?.toMillis ? a.data().timestamp.toMillis() : 0;
        const timeB = b.data().timestamp?.toMillis ? b.data().timestamp.toMillis() : 0;
        return timeB - timeA;
      });

      const newStats = { 
        totalRevenue: 0, 
        totalItems: 0, 
        productSales: {} as Record<string, { count: number; revenue: number; name: string }> 
      };
      
      docs.forEach(doc => {
        const data = doc.data();
        newStats.totalRevenue += data.amount || 0;
        
        // Detailed items analysis (New format)
        if (data.detailedItems && Array.isArray(data.detailedItems)) {
          data.detailedItems.forEach((item: { name: string; quantity: number; subtotal: number }) => {
            newStats.totalItems += item.quantity;
            if (!newStats.productSales[item.name]) {
              newStats.productSales[item.name] = { count: 0, revenue: 0, name: item.name };
            }
            newStats.productSales[item.name].count += item.quantity;
            newStats.productSales[item.name].revenue += item.subtotal;
          });
        } 
        // Fallback for old simple "items" array format
        else if (data.items && Array.isArray(data.items)) {
          data.items.forEach((itemStr: string) => {
            const match = itemStr.match(/(\d+)x\s(.+)/);
            if (match) {
              const qty = parseInt(match[1]);
              const name = match[2];
              newStats.totalItems += qty;
              if (!newStats.productSales[name]) {
                newStats.productSales[name] = { count: 0, revenue: 0, name };
              }
              newStats.productSales[name].count += qty;
            }
          });
        }
      });

      setStats(newStats);
      setStatsLoading(false);
    });

    return () => unsub();
  }, [activeTab, activeStallId]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [products, searchQuery]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage]);

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const markAsDelivered = async (orderId: string) => {
    try {
      await updateDoc(doc(collection(db, 'orders'), orderId), {
        status: 'delivered',
        deliveredAt: serverTimestamp()
      });
      toast.success('Pedido entregue!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  }, [cart]);

  const cartItemsNames = useMemo(() => {
    return cart.map(item => `${item.quantity}x ${item.name}`).join(', ');
  }, [cart]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.id !== productId);
    });
  };

  const deleteItemFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const clearCart = () => setCart([]);

  const onScanSuccess = async (decodedText: string) => {
    try {
      const cleanText = decodedText.trim();
      if (!cleanText) return;

      setIsScanning(false);
      setIsSearchingClient(true);
      const toastId = toast.loading('Identificando cliente...', { id: 'v-scan' });
      
      let userDoc: any = null;

      // 1. Validar e preparar a referência direta de documento de forma segura contra exceções de rotas com "/"
      let userRef: any = null;
      if (cleanText && !cleanText.includes('/') && cleanText.length < 100) {
        try {
          userRef = doc(db, 'users', cleanText);
        } catch (e) {
          console.warn("[LOOKUP] ID de documento inválido:", cleanText, e);
        }
      }

      const qMain = query(collection(db, 'users'), where('qrCode', '==', cleanText), limit(1));
      const qCards = query(collection(db, 'users'), where('linkedCards', 'array-contains', cleanText), limit(1));

      // 2. PRIMEIRA TENTATIVA: Cache Local (Tempo de resposta instantâneo, ~2ms)
      try {
        const cachePromises = [
          userRef ? getDocFromCache(userRef).catch(() => null) : Promise.resolve(null),
          getDocsFromCache(qMain)
            .then(snap => (!snap.empty ? snap.docs[0] : null))
            .catch(() => null),
          getDocsFromCache(qCards)
            .then(snap => (!snap.empty ? snap.docs[0] : null))
            .catch(() => null)
        ];
        
        const cacheResults = await Promise.all(cachePromises);
        userDoc = cacheResults.find(r => r && typeof r.exists === 'function' && r.exists());
      } catch (cacheErr) {
        console.warn("[CACHE] Erro ou ausência de cache local:", cacheErr);
      }

      // 3. SEGUNDA TENTATIVA: Servidor em Paralelo com Limite de Tempo de 4 segundos (Evita esperas longas de rede)
      if (!userDoc) {
        try {
          const serverPromises = [
            userRef ? getDoc(userRef).catch(() => null) : Promise.resolve(null),
            getDocs(qMain)
              .then(snap => (!snap.empty ? snap.docs[0] : null))
              .catch(() => null),
            getDocs(qCards)
              .then(snap => (!snap.empty ? snap.docs[0] : null))
              .catch(() => null)
          ];
          
          // Corrida de promessas: busca no servidor ou timeout de 4s
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
          
          const serverResult = await Promise.race([
            Promise.all(serverPromises).then(results => results.find(r => r && typeof r.exists === 'function' && r.exists()) || null),
            timeoutPromise
          ]);
          
          userDoc = serverResult;
        } catch (serverErr) {
          console.error("[SERVER] Erro na consulta ao servidor:", serverErr);
        }
      }

      toast.dismiss(toastId);
      setIsSearchingClient(false);

      if (!userDoc) {
        setStatusModal({
          show: true,
          type: 'error',
          title: 'Erro de Identificação',
          message: 'QR Code ou Cartão não reconhecido ou instabilidade na rede. Verifique o cadastro do cliente e tente novamente.'
        });
        return;
      }

      let userData = { ...userDoc.data(), uid: userDoc.id, scannedCardCode: cleanText } as UserProfile & { scannedCardCode?: string };

      // Se o usuário possuir saldo compartilhado com um parente/responsável (parentUid)
      if ((!userData.balanceType || userData.balanceType === 'shared') && userData.parentUid) {
        try {
          const parentDoc = await getDoc(doc(db, 'users', userData.parentUid)).catch(() => null);
          if (parentDoc && parentDoc.exists()) {
            const parentData = parentDoc.data() as UserProfile;
            userData.balance = parentData.balance || 0;
          }
        } catch (parentErr) {
          console.error("Erro ao buscar saldo compartilhado do responsável:", parentErr);
        }
      }

      setScannedUser(userData);
      toast.success(`Cliente ${userData.name} identificado com sucesso!`);
    } catch (error) {
      console.error(error);
      setIsSearchingClient(false);
      toast.dismiss('v-scan');
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  };

  const handleSale = async () => {
    if (!scannedUser || cartTotal <= 0) return;

    setProcessing(true);
    const failsafe = setTimeout(() => {
      setProcessing(false);
      toast.error("Tempo limite atingido.");
    }, 25000);

    try {
      
      if (scannedUser.balance < cartTotal) {
        clearTimeout(failsafe);
        setProcessing(false);
        setStatusModal({
          show: true,
          type: 'error',
          title: 'Saldo Insuficiente',
          message: `Eu fiz a venda e tem saldo indisponível. O saldo não é suficiente.\n\nCliente: ${scannedUser.name}\nSaldo Atual: R$ ${scannedUser.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nValor Necessário: R$ ${cartTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        });
        return;
      }

      // Validar limite por compra individual (Single transaction limit)
      if (scannedUser.transactionLimit && scannedUser.transactionLimit > 0 && cartTotal > scannedUser.transactionLimit) {
        clearTimeout(failsafe);
        setProcessing(false);
        setStatusModal({
          show: true,
          type: 'error',
          title: 'Limite por Compra Excedido',
          message: `Este cartão possui um limite máximo de R$ ${scannedUser.transactionLimit?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por compra.\n\nCliente: ${scannedUser.name}\nValor da Compra: R$ ${cartTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        });
        return;
      }

      // Validar limite diário acumulado (Daily spending limit limit)
      const todayStr = new Date().toISOString().split('T')[0];
      const currentSpentToday = (scannedUser.lastSpentDate === todayStr) ? (scannedUser.spentToday || 0) : 0;
      
      if (scannedUser.dailyLimit && scannedUser.dailyLimit > 0 && (currentSpentToday + cartTotal) > scannedUser.dailyLimit) {
        clearTimeout(failsafe);
        setProcessing(false);
        const remainingLimit = Math.max(0, scannedUser.dailyLimit - currentSpentToday);
        setStatusModal({
          show: true,
          type: 'error',
          title: 'Limite Diário Excedido',
          message: `Este cartão possui um limite diário de R$ ${scannedUser.dailyLimit?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.\n\nCliente: ${scannedUser.name}\nJá gasto hoje: R$ ${currentSpentToday.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nDisponível restante: R$ ${remainingLimit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nTentativa de compra: R$ ${cartTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        });
        return;
      }

      // Executar todos os registros no banco em paralelo para velocidade máxima (3x mais rápido!)
      const isShared = (!scannedUser.balanceType || scannedUser.balanceType === 'shared') && !!scannedUser.parentUid;
      const nextSpentToday = currentSpentToday + cartTotal;
      
      let updateBalancePromise;
      if (isShared) {
        updateBalancePromise = Promise.all([
          updateDoc(doc(db, 'users', scannedUser.parentUid!), {
            balance: increment(-cartTotal)
          }),
          updateDoc(doc(db, 'users', scannedUser.uid), {
            spentToday: nextSpentToday,
            lastSpentDate: todayStr
          })
        ]).catch(e => {
          handleFirestoreError(e, OperationType.UPDATE, `users/${scannedUser!.uid}`);
          throw e;
        });
      } else {
        updateBalancePromise = updateDoc(doc(db, 'users', scannedUser.uid), {
          balance: increment(-cartTotal),
          spentToday: nextSpentToday,
          lastSpentDate: todayStr
        }).catch(e => {
          handleFirestoreError(e, OperationType.UPDATE, `users/${scannedUser!.uid}`);
          throw e;
        });
      }

      const activeCardNumber = scannedUser.uid || (scannedUser as any).scannedCardCode || scannedUser.qrCode || '';

      const writeTransactionPromise = addDoc(collection(db, 'transactions'), {
        userId: scannedUser.uid,
        userName: scannedUser.name,
        clientName: scannedUser.name,
        cardNumber: activeCardNumber,
        amount: -cartTotal,
        type: 'debit',
        description: `Compra na barraca ${stall?.name || ''}: ${cartItemsNames}`,
        stallName: stall?.name || 'Barraca',
        items: cart.map(item => `${item.quantity}x ${item.name}`),
        vendorId: profile.uid,
        status: 'completed',
        timestamp: serverTimestamp()
      }).catch(e => {
        handleFirestoreError(e, OperationType.CREATE, 'transactions');
      });

      const writeConsumptionPromise = addDoc(collection(db, 'consumption'), {
        studentId: scannedUser.uid,
        studentName: scannedUser.name,
        clientName: scannedUser.name,
        cardNumber: activeCardNumber,
        vendorId: profile.uid,
        stallId: activeStallId,
        amount: cartTotal,
        items: cart.map(item => `${item.quantity}x ${item.name}`),
        detailedItems: cart.map(item => ({
          productId: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.price * item.quantity
        })),
        timestamp: serverTimestamp()
      }).catch(e => {
        handleFirestoreError(e, OperationType.CREATE, 'consumption');
      });

      await Promise.all([updateBalancePromise, writeTransactionPromise, writeConsumptionPromise]);

      const completedItems = [...cart];

      setStatusModal({
        show: true,
        type: 'success',
        title: 'Venda Concluída!',
        message: `Cliente: ${scannedUser.name}\nCartão: ${formatCardNumber(activeCardNumber)}\n\nO pagamento de R$ ${cartTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} foi processado com sucesso.\nNovo saldo do cliente: R$ ${(scannedUser.balance - cartTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        items: completedItems
      });

      // Guardar detalhes para conferência na aba Pedidos
      setLastSale({
        userName: scannedUser.name,
        total: cartTotal,
        items: cart.map(item => `${item.quantity}x ${item.name}`),
        timestamp: new Date()
      });

      // Clear cart and client for the next sale
      setScannedUser(null);
      clearCart();
    } catch (error) {
      console.error('Erro no processamento da venda:', error);
      // Already handled by nested tries or generic catch if top-level logic fails
    } finally {
      clearTimeout(failsafe);
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="h-screen bg-slate-900 flex items-center justify-center font-bold text-white">Carregando Terminal...</div>;
  }

  if (!(profile.vendorIds && profile.vendorIds.length > 0) && profile.role !== 'admin') {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center text-white">
        <Store className="h-20 w-20 text-slate-700 mb-6" />
        <h1 className="text-3xl font-black mb-4">Barraca Não Vinculada</h1>
        <p className="text-slate-400 max-w-md">O administrador precisa vincular seu perfil a uma barraca nas configurações.</p>
        <Button variant="ghost" onClick={() => auth.signOut()} className="mt-8 text-slate-500">Sair da conta</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-32 md:pb-8 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-indigo-600/10 blur-[100px] rounded-full" />
        <div className="absolute -bottom-[10%] left-[20%] w-[50%] h-[40%] bg-blue-900/10 blur-[150px] rounded-full" />
      </div>

      <div className="max-w-[1536px] mx-auto px-4 py-4 md:px-6 md:py-6 space-y-6 relative z-10">
        <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900/40 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-2xl sticky top-2 z-30 transition-all duration-300">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Terminal Ativo</p>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-black text-white tracking-tight leading-none">{stall?.name || 'Carregando...'}</h2>
                {(profile.role === 'admin' || (profile.vendorIds && profile.vendorIds.length > 1)) && (
                  <select 
                    className="bg-white/5 hover:bg-white/10 text-[10px] px-3 py-1.5 rounded-xl border border-white/10 font-black text-blue-400 uppercase outline-none transition-all cursor-pointer"
                    value={activeStallId || ''}
                    onChange={(e) => setActiveStallId(e.target.value)}
                  >
                    {profile.role === 'admin' && <option value="" className="bg-slate-900">Selecionar...</option>}
                    {availableStalls.map(s => <option key={s.id} value={s.id} className="bg-slate-900">{s.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-between sm:justify-end">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="bg-white/5 p-1 rounded-2xl border border-white/5">
              <TabsList className="bg-transparent border-none h-10 gap-1">
                <TabsTrigger value="pos" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all">
                   <ShoppingCart className="h-3.5 w-3.5 mr-2" /> PDV
                </TabsTrigger>
                <TabsTrigger value="orders" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all relative">
                   <Clock className="h-3.5 w-3.5 mr-2" /> Pedidos
                   {orders.length > 0 && (
                     <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[8px] font-black h-5 w-5 flex items-center justify-center rounded-full border-2 border-slate-900 shadow-lg">
                       {orders.length}
                     </span>
                   )}
                </TabsTrigger>
                <TabsTrigger value="analytics" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white font-black text-[10px] uppercase h-8 px-4 rounded-xl transition-all">
                   <BarChart3 className="h-3.5 w-3.5 mr-2" /> Análise
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="hidden sm:block h-8 w-px bg-white/10 mx-1" />

            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-500 ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500 animate-pulse'}`}>
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="text-[9px] font-black uppercase tracking-widest hidden xs:inline">{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            <div className="hidden sm:flex items-center gap-4 bg-white/10 px-4 py-2 rounded-2xl border border-white/20">
              <div className="text-right">
                <p className="text-[10px] font-black text-white uppercase leading-none mb-1 truncate max-w-[100px]">{profile.name}</p>
                <p className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">{profile.role}</p>
              </div>
              <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center font-black text-xs text-white">
                {profile.name.charAt(0).toUpperCase()}
              </div>
            </div>

            <Button 
                variant="ghost" 
                onClick={() => {
                  toast.promise(async () => {
                    if ('serviceWorker' in navigator) {
                      const registrations = await navigator.serviceWorker.getRegistrations();
                      for (let reg of registrations) await reg.unregister();
                    }
                    window.location.reload();
                  }, {
                    loading: 'Limpando cache...',
                    success: 'Atualizando...',
                    error: 'Erro ao atualizar'
                  });
                }} 
                className="h-11 px-4 bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white rounded-2xl transition-all flex items-center gap-2 font-black uppercase tracking-widest text-[10px]"
                title="Atualizar App"
              >
              <Zap className="h-4 w-4" />
              <span className="hidden xs:inline">Atualizar</span>
            </Button>

            <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => auth.signOut()} 
                className="h-11 w-11 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl transition-all"
              >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'pos' ? (
            <motion.div 
              key="pos"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-8 items-start transition-all"
            >
              {/* Product Area */}
              <div className="w-full space-y-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 mb-1">Cardápio do Evento</h3>
                    <p className="text-xs font-bold text-slate-400">Toque para adicionar, clique longo ou botão (-) para remover</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                    <Zap className="h-4 w-4 text-blue-500" />
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Atendimento Rápido</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4 overflow-y-auto max-h-[70vh] pr-2 custom-scrollbar pb-10">
                  {paginatedProducts.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="col-span-full py-40 text-center text-slate-600 bg-white/[0.02] rounded-[40px] border-4 border-dashed border-white/5"
                    >
                      <PackageCheck className="h-16 w-16 mx-auto opacity-10 mb-4" />
                      <p className="text-lg font-black uppercase tracking-widest opacity-20">Aguardando estoque</p>
                    </motion.div>
                  ) : (
                    paginatedProducts.map((product, index) => {
                      const cartItem = cart.find(i => i.id === product.id);
                      const count = cartItem?.quantity || 0;
                      return (
                        <div key={product.id} className="relative group">
                          <motion.button
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.95 }}
                            transition={{ 
                              type: 'spring', 
                              stiffness: 400, 
                              damping: 15,
                              delay: index * 0.03 
                            }}
                            onClick={() => addToCart(product)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (count > 0) removeFromCart(product.id);
                            }}
                            className={`w-full aspect-square flex flex-col items-start justify-end p-5 rounded-[32px] border-2 transition-all text-left relative overflow-hidden ${
                              count > 0 
                                ? 'bg-blue-600 border-blue-400 shadow-[0_20px_60px_rgba(37,99,235,0.3)] ring-4 ring-blue-500/10' 
                                : 'bg-white/[0.03] border-white/5 hover:border-blue-500/30 hover:bg-white/[0.06]'
                            }`}
                          >
                            <AnimatePresence>
                              {count > 0 && (
                                <motion.div 
                                  initial={{ scale: 0, rotate: -45, y: 10 }}
                                  animate={{ scale: 1, rotate: 0, y: 0 }}
                                  exit={{ scale: 0, rotate: 45, y: 10 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                                  className="absolute top-4 right-4 bg-white text-blue-600 text-[12px] font-black h-9 w-9 flex items-center justify-center rounded-2xl shadow-2xl z-20 border-2 border-blue-100 ring-4 ring-white/10"
                                >
                                  {count}
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <div className={`absolute inset-0 bg-gradient-to-br transition-opacity duration-500 ${count > 0 ? 'from-white/10 to-transparent' : 'from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100'}`} />
                            
                            <div className="relative z-10 w-full space-y-1 pr-6">
                              <span className={`block text-[10px] font-black uppercase tracking-[0.1em] line-clamp-1 leading-tight transition-all ${count > 0 ? 'text-blue-100' : 'text-slate-500 group-hover:text-blue-300'}`}>
                                {product.category || 'Geral'}
                              </span>
                              <span className={`block text-[12px] font-black uppercase tracking-tight line-clamp-2 leading-tight transition-all ${count > 0 ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                                {product.name}
                              </span>
                              <div className="pt-2">
                                <span className={`text-xl font-black tabular-nums transition-all ${count > 0 ? 'text-white' : 'text-white'}`}>
                                  <span className="text-[10px] font-bold mr-0.5 opacity-60">R$</span> {product.price.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </motion.button>

                          {count > 0 && (
                            <motion.button
                              initial={{ opacity: 0, scale: 0.5 }}
                              animate={{ opacity: 1, scale: 1 }}
                              whileTap={{ scale: 0.8 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromCart(product.id);
                              }}
                              className="absolute bottom-4 right-4 h-10 w-10 bg-slate-950/80 backdrop-blur-md rounded-2xl border border-white/20 flex items-center justify-center text-white z-30 hover:bg-red-500 transition-colors shadow-lg"
                            >
                              <Minus className="h-5 w-5" strokeWidth={3} />
                            </motion.button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-6 pt-6 pb-4">
                    <Button 
                      variant="ghost" 
                      size="lg" 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl h-12 px-6 font-black text-[10px] uppercase"
                    >
                      <ChevronLeft className="h-4 w-4 mr-2" /> Anterior
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({length: totalPages}).map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${currentPage === i + 1 ? 'w-8 bg-blue-500' : 'w-1.5 bg-white/10'}`} />
                      ))}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="lg" 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl h-12 px-6 font-black text-[10px] uppercase"
                    >
                      Próxima <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Sidebar: Shopping Bag */}
              <div className="hidden lg:block w-full sticky top-24 space-y-6">
                <Card className="bg-slate-900/60 backdrop-blur-3xl border border-white/10 text-white rounded-[32px] overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] transition-all">
                  <header className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 bg-white/5 rounded-xl flex items-center justify-center">
                        <ShoppingCart className="h-4 w-4 text-blue-400" />
                      </div>
                      <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400">Carrinho</h3>
                    </div>
                    {cart.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearCart} className="text-red-400 h-8 text-[10px] font-black hover:bg-red-500/10 rounded-xl px-3 transition-colors">
                        LIMPAR
                      </Button>
                    )}
                  </header>
                  
                  <CardContent className="p-0">
                    <div className="max-h-[min(420px,55vh)] overflow-y-auto custom-scrollbar px-6">
                      {cart.length === 0 ? (
                        <div className="py-24 text-center space-y-4">
                          <div className="h-20 w-20 bg-white/[0.02] rounded-full flex items-center justify-center mx-auto ring-1 ring-white/5 shadow-inner">
                            <ShoppingCart className="h-10 w-10 opacity-10 text-slate-400" />
                          </div>
                          <p className="text-[11px] font-black text-slate-600 uppercase tracking-[0.2em] leading-relaxed">Sua sacola<br/>está vazia</p>
                        </div>
                      ) : (
                        <div className="py-4 space-y-3">
                          <AnimatePresence initial={false} mode="popLayout">
                            {cart.map((item) => (
                              <motion.div 
                                key={item.id}
                                layout
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                                className="flex items-center justify-between p-4 bg-white/[0.04] rounded-2xl border border-white/5 group hover:border-blue-500/30 transition-all shadow-lg"
                              >
                                <div className="flex-1 mr-4 min-w-0">
                                  <p className="font-black text-[11px] uppercase truncate text-white/90 tracking-tight leading-tight mb-1">{item.name}</p>
                                  <p className="text-[11px] text-blue-400 font-bold tabular-nums">R$ {item.price.toFixed(2)}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl ring-1 ring-white/10">
                                    <motion.button 
                                      whileTap={{ scale: 0.8 }}
                                      onClick={() => removeFromCart(item.id)} 
                                      className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-slate-500 hover:text-red-400 transition-colors"
                                    >
                                      <Minus size={14} strokeWidth={3}/>
                                    </motion.button>
                                    <span className="w-6 text-center text-xs font-black tabular-nums">{item.quantity}</span>
                                    <motion.button 
                                      whileTap={{ scale: 0.8 }}
                                      onClick={() => addToCart(item)} 
                                      className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                      <Plus size={14} strokeWidth={3}/>
                                    </motion.button>
                                  </div>
                                  
                                  <button 
                                    onClick={() => deleteItemFromCart(item.id)}
                                    className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/[0.02] border border-white/5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-all group/trash"
                                  >
                                    <Trash2 className="h-4 w-4 group-hover/trash:scale-110 transition-transform" />
                                  </button>
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    <div className="p-8 bg-slate-950/40 border-t border-white/10 space-y-6">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Total Geral</span>
                          <div className="text-4xl font-black text-white tracking-tighter">
                            <span className="text-xl font-bold mr-1 opacity-40">R$</span>
                            {cartTotal.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-[10px] font-black text-blue-500/50 uppercase tracking-widest bg-blue-500/5 px-3 py-1 rounded-full border border-blue-500/10">
                          {cart.reduce((a, b) => a + b.quantity, 0)} Itens
                        </div>
                      </div>

                      {!scannedUser ? (
                        <div className="space-y-3">
                          <Button 
                            onClick={() => setIsScanning(true)}
                            disabled={cart.length === 0}
                            className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-[0.3em] rounded-2xl shadow-[0_20px_40px_rgba(37,99,235,0.3)] border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all group overflow-hidden relative"
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                            <QrCode className="mr-3 h-6 w-6" /> Escanear Carteira
                          </Button>
                          
                          <div className="relative">
                            <Input
                              placeholder="FOCO P/ LEITOR DE CARTÃO (RFID/SWIPE)"
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  const text = e.currentTarget.value.trim();
                                  if (text) {
                                    await onScanSuccess(text);
                                    e.currentTarget.value = '';
                                  }
                                }
                              }}
                              disabled={cart.length === 0}
                              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 font-bold uppercase text-[11px] tracking-wider text-center h-12 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none w-full"
                              autoFocus={cart.length > 0}
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                              <span className="text-[8px] font-black uppercase text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">Leitor USB</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white/5 p-5 rounded-3xl border-2 border-blue-600/30 space-y-5"
                        >
                           <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-2xl border border-white/5">
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-lg">
                                  {scannedUser.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-black text-xs uppercase truncate text-white leading-none mb-1">{scannedUser.name}</p>
                                  <p className="text-[11px] font-black text-blue-400 font-mono tracking-wide leading-none mt-1">
                                    {formatCardNumber(scannedUser.uid || (scannedUser as any).scannedCardCode || scannedUser.qrCode || '')}
                                  </p>
                                  <p className="text-[8px] font-bold text-slate-500 font-mono tracking-tight mb-1.5 mt-0.5">
                                    ID: {(scannedUser as any).scannedCardCode || scannedUser.qrCode || scannedUser.uid}
                                  </p>
                                  <div className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                                    scannedUser.balance < cartTotal ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-400'
                                  }`}>
                                    Saldo: R$ {scannedUser.balance.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => setScannedUser(null)} 
                                className="h-8 w-8 flex items-center justify-center hover:bg-white/10 rounded-xl transition-all text-slate-500 hover:text-white"
                              >
                                <XCircle className="h-5 w-5" />
                              </button>
                           </div>
                           
                           <Button 
                             onClick={handleSale}
                             disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                             className={`w-full h-14 font-black uppercase text-xs tracking-[0.2em] rounded-2xl transition-all ${
                               scannedUser.balance < cartTotal 
                                ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                                : 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-600/20 active:scale-95'
                             }`}
                           >
                              {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : 
                               scannedUser.balance < cartTotal ? 'SALDO INSUFICIENTE' : 'CONCLUIR PAGAMENTO'}
                           </Button>
                        </motion.div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          ) : activeTab === 'orders' ? (
          <motion.div 
            key="orders"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            className="space-y-8 pb-10"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
               <div className="flex items-center gap-4">
                 <div className="h-14 w-14 bg-gradient-to-br from-blue-500 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Package className="h-7 w-7 text-white" />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">Central de Pedidos</h3>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Controle seus pedidos digitais e vendas diretas do PDV</p>
                 </div>
               </div>
               
               {/* Sub-tabs comutadoras embutidas */}
               <div className="flex bg-slate-950/80 p-1 rounded-2xl border border-white/10 w-full lg:w-auto self-stretch lg:self-center">
                 <button
                   onClick={() => setOrdersSubTab('pending')}
                   className={`flex-1 lg:flex-none py-2.5 px-6 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                     ordersSubTab === 'pending'
                       ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                       : 'text-slate-400 hover:text-white hover:bg-white/5'
                   }`}
                 >
                   <Clock className="h-3.5 w-3.5" />
                   Pendentes ({orders.length})
                 </button>
                 <button
                   onClick={() => setOrdersSubTab('history')}
                   className={`flex-1 lg:flex-none py-2.5 px-6 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                     ordersSubTab === 'history'
                       ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                       : 'text-slate-400 hover:text-white hover:bg-white/5'
                   }`}
                 >
                   <Search className="h-3.5 w-3.5" />
                   Histórico / PDV ({allPreviousOrders.length})
                 </button>
               </div>
            </div>

            {ordersSubTab === 'pending' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Seção de Última Venda Realizada - Para Conferência */}
                {lastSale && (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="col-span-full"
                  >
                    <Card className="bg-emerald-500/10 border-emerald-500/20 text-emerald-100 rounded-[32px] overflow-hidden">
                      <CardHeader className="bg-emerald-500/10 border-b border-emerald-500/10 p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                              <CheckCircle2 className="h-5 w-5 text-white" />
                            </div>
                            <div>
                              <CardTitle className="text-sm font-black uppercase tracking-widest text-emerald-400">Última Venda Realizada</CardTitle>
                              <CardDescription className="text-[10px] text-emerald-500/70 font-bold uppercase tracking-widest">Concluída há pouco para conferência</CardDescription>
                            </div>
                          </div>
                          <span className="text-[10px] font-black tabular-nums bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/10">
                            {lastSale.timestamp.toLocaleTimeString('pt-BR')}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                          <div className="space-y-4">
                            <div className="bg-black/20 p-4 rounded-2xl border border-emerald-500/10">
                               <div className="flex items-center gap-2 mb-2">
                                  <UserCheck className="h-4 w-4 text-emerald-500" />
                                  <span className="text-[10px] font-black uppercase text-emerald-500/70">Cliente</span>
                               </div>
                               <p className="font-black text-lg uppercase tracking-tight">{lastSale.userName}</p>
                            </div>
                            <div className="bg-black/20 p-4 rounded-2xl border border-emerald-500/10">
                               <div className="flex items-center gap-2 mb-2">
                                  <Receipt className="h-4 w-4 text-emerald-500" />
                                  <span className="text-[10px] font-black uppercase text-emerald-500/70">Total Pago</span>
                               </div>
                               <p className="font-black text-3xl tracking-tighter">
                                 <span className="text-base font-bold opacity-50 mr-1">R$</span>
                                 {lastSale.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                               </p>
                            </div>
                          </div>
                          
                          <div className="bg-emerald-950/20 p-6 rounded-3xl border-2 border-emerald-500/10 relative overflow-hidden">
                             <div className="absolute top-0 right-0 p-4 opacity-5">
                               <ShoppingCart className="h-24 w-24" />
                             </div>
                             <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-4 flex items-center gap-2">
                               <Package className="h-3 w-3" /> Itens Vendidos
                             </h4>
                             <ul className="space-y-2">
                                {lastSale.items.map((item, i) => (
                                  <li key={i} className="flex justify-between items-center text-xs font-bold text-emerald-100/90 py-2 border-b border-white/5 last:border-0">
                                     <span className="bg-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-black mr-2">{item.split('x')[0]}x</span>
                                     <span className="flex-1 truncate uppercase">{item.split('x')[1].trim()}</span>
                                  </li>
                                ))}
                             </ul>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {orders.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="col-span-full py-40 text-center text-slate-500 border-4 border-dashed border-white/5 rounded-[48px] bg-white/[0.01] backdrop-blur-sm"
                  >
                    <Clock className="h-20 w-20 mx-auto opacity-10 mb-6" />
                    <p className="text-lg font-black uppercase tracking-[0.2em] opacity-30">Aguardando novos pedidos...</p>
                    <Button 
                      variant="ghost" 
                      onClick={() => setActiveTab('pos')} 
                      className="mt-6 font-black text-[10px] uppercase tracking-widest text-blue-500 hover:text-white hover:bg-blue-600/20 rounded-full px-8 py-6 h-auto transition-all"
                    >
                      VOLTAR AO PDV
                    </Button>
                  </motion.div>
                ) : (
                  orders.map((order, idx) => {
                    const isExpanded = expandedOrderId === order.id;
                    return (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        layout
                      >
                        <Card 
                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                          className={`bg-slate-900/40 backdrop-blur-xl border border-white/10 text-white rounded-[32px] overflow-hidden group hover:border-blue-500/50 transition-all shadow-2xl relative cursor-pointer active:scale-[0.99] ${isExpanded ? 'ring-2 ring-blue-500/40' : ''}`}
                        >
                          {/* Status Badge */}
                          <div className="absolute top-6 right-6 flex items-center gap-2 z-20">
                            <div className="flex items-center gap-1.5 bg-blue-500/10 px-3 py-1.5 rounded-xl border border-blue-500/20">
                              <Clock className="h-3 w-3 text-blue-400 animate-pulse" />
                              <span className="text-[9px] font-black uppercase text-blue-400 tracking-widest">PENDENTE</span>
                            </div>
                            <div className={`transition-transform duration-300 bg-white/5 p-1.5 rounded-xl border border-white/5 ${isExpanded ? 'rotate-180' : ''}`}>
                              <ChevronDown className="h-4 w-4 text-slate-500" />
                            </div>
                          </div>

                          <CardHeader className={`p-8 transition-colors ${isExpanded ? 'bg-white/5' : 'bg-transparent'}`}>
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">#{order.id.slice(-6).toUpperCase()}</span>
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-blue-600/20 rounded-xl flex items-center justify-center font-black text-blue-400 border border-blue-500/20">
                                  {order.studentName.charAt(0).toUpperCase()}
                                </div>
                                <CardTitle className="text-xl font-black tracking-tight">{order.studentName}</CardTitle>
                              </div>
                              <div className="flex items-center gap-4 mt-3">
                                <div className="flex items-center gap-1.5 text-slate-400">
                                  <Package className="h-3.5 w-3.5" />
                                  <span className="text-[10px] font-black uppercase tracking-widest">{order.items.length} {order.items.length === 1 ? 'Item' : 'Itens'}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-blue-400">
                                  <TrendingUp className="h-3.5 w-3.5" />
                                  <span className="text-[10px] font-black uppercase tracking-widest tabular-nums">R$ {order.total.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                          </CardHeader>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                              >
                                <CardContent className="p-8 pt-0 space-y-6">
                                  <div className="h-px bg-white/5 w-full mb-6" />
                                  
                                  <div className="space-y-3">
                                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 flex items-center justify-between">
                                      <span>Produtos do Pedido</span>
                                      {order.timestamp && (
                                         <span className="text-slate-600 lowercase font-normal italic">
                                           at {new Date(order.timestamp.toMillis?.() || Date.now()).toLocaleTimeString()}
                                         </span>
                                      )}
                                    </p>
                                    <div className="grid gap-2">
                                      {order.items.map((item, idx) => (
                                        <div key={idx} className="group/item flex items-center justify-between bg-white/[0.03] p-4 rounded-2xl border border-white/5 hover:bg-white/[0.05] transition-all">
                                          <div className="flex items-center gap-3">
                                            <div className="h-6 w-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                              <Package className="h-3 w-3 text-blue-500 group-hover/item:scale-110 transition-transform" />
                                            </div>
                                            <p className="font-black text-xs uppercase text-slate-200 tracking-tight">{item}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-4 items-center justify-between">
                                    <div className="text-center sm:text-left">
                                      <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-1">Total Confirmado</p>
                                      <div className="text-3xl font-black text-white tracking-tighter">
                                        <span className="text-sm font-bold opacity-30 mr-1">R$</span>
                                        {order.total.toFixed(2)}
                                      </div>
                                    </div>

                                    <Button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        markAsDelivered(order.id);
                                      }}
                                      className="w-full sm:w-auto h-14 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-[0.2em] gap-3 rounded-2xl shadow-[0_15px_30px_-5px_rgba(16,185,129,0.3)] transition-all group overflow-hidden relative px-8"
                                    >
                                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                                      <div className="flex items-center gap-2">
                                        <PackageCheck className="h-5 w-5" />
                                        ENTREGAR AGORA
                                      </div>
                                    </Button>
                                  </div>
                                </CardContent>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </Card>
                      </motion.div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Campo de Busca de Pedidos Anteriores */}
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    type="text"
                    placeholder="Buscar por nome do cliente, produto comprado, final do ID ou cartão..."
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    className="pl-12 pr-4 py-6 h-auto bg-white/[0.02] border-white/10 rounded-2xl text-white placeholder-slate-500 text-sm focus:ring-blue-500/50 focus:border-blue-500 w-full"
                  />
                </div>

                {filteredPreviousOrders.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="py-32 text-center text-slate-500 border-4 border-dashed border-white/5 rounded-[48px] bg-white/[0.01]"
                  >
                    <Search className="h-16 w-16 mx-auto opacity-10 mb-4" />
                    <p className="text-base font-black uppercase tracking-[0.2em] opacity-30">Nenhum pedido anterior encontrado</p>
                    <p className="text-slate-600 text-xs mt-2 uppercase tracking-widest">Tente usar outros termos de pesquisa</p>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredPreviousOrders.slice(0, 80).map((histOrder, idx) => {
                      const isPDV = histOrder.type === 'pdv';
                      const dateStr = histOrder.timestamp?.toMillis 
                        ? new Date(histOrder.timestamp.toMillis()).toLocaleString('pt-BR')
                        : (histOrder.timestamp instanceof Date ? histOrder.timestamp.toLocaleString('pt-BR') : 'Sem data');

                      return (
                        <motion.div
                          key={histOrder.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(idx * 0.03, 0.3) }}
                        >
                          <Card className="bg-slate-900/30 backdrop-blur-xl border border-white/10 text-white rounded-[24px] overflow-hidden hover:border-blue-500/30 transition-all shadow-xl h-full flex flex-col justify-between">
                            <CardHeader className="p-5 bg-white/[0.02] border-b border-white/5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-wider">
                                    #{histOrder.id.slice(-6).toUpperCase()}
                                  </span>
                                  {isPDV ? (
                                    <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border border-emerald-500/20 tracking-wider">
                                      Venda Direta PDV
                                    </span>
                                  ) : (
                                    <span className="bg-blue-500/10 text-blue-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border border-blue-500/20 tracking-wider">
                                      Pedido Digital
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                                  {dateStr}
                                </span>
                              </div>
                            </CardHeader>
                            <CardContent className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                              <div className="space-y-3">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="space-y-1 min-w-0">
                                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider leading-none">Cliente</p>
                                    <p className="font-extrabold text-sm text-slate-200 uppercase tracking-tight truncate max-w-[180px]">
                                      {histOrder.clientName}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider leading-none">Total Pago</p>
                                    <p className="font-black text-sm text-blue-400 tabular-nums">
                                      R$ {histOrder.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                  </div>
                                </div>

                                {histOrder.cardNumber && (
                                  <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/5 flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-widest">Cartão Usado</span>
                                    <span className="text-[10px] font-black text-slate-300 font-mono">
                                      {formatCardNumber(histOrder.cardNumber)}
                                    </span>
                                  </div>
                                )}

                                <div className="space-y-1.5">
                                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider leading-none">Itens Comprados</p>
                                  <div className="bg-white/[0.01] rounded-2xl border border-white/5 p-3 space-y-1.5 max-h-[140px] overflow-y-auto custom-scrollbar">
                                    {histOrder.items.map((item: string, i: number) => {
                                      const parts = item.split('x');
                                      const qty = parts[0] || '1';
                                      const name = parts.slice(1).join('x').trim() || item;
                                      return (
                                        <div key={i} className="flex justify-between items-center text-[11px] font-semibold text-slate-300">
                                          <span className="bg-white/5 px-1.5 py-0.5 rounded text-[9px] font-black text-slate-400">
                                            {qty}x
                                          </span>
                                          <span className="flex-1 truncate uppercase text-left pl-2 text-slate-300">{name}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
             key="analytics"
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0, scale: 1.05 }}
             className="space-y-10 pb-10"
          >
              <div className="flex items-center gap-4 bg-white/[0.03] p-6 rounded-[32px] border border-white/5">
                <div className="h-14 w-14 bg-gradient-to-br from-indigo-500 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <BarChart3 className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">Análise Estratégica</h3>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Desempenho da sua barraca em tempo real</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-green-500/10 blur-3xl rounded-full group-hover:bg-green-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-green-500/10 rounded-2xl flex items-center justify-center ring-1 ring-green-500/20">
                            <TrendingUp className="h-6 w-6 text-green-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Faturamento Total</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              <span className="text-xl font-bold opacity-40 mr-1">R$</span>
                              {stats.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>

                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-blue-500/10 blur-3xl rounded-full group-hover:bg-blue-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-blue-500/10 rounded-2xl flex items-center justify-center ring-1 ring-blue-500/20">
                            <Package className="h-6 w-6 text-blue-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Volumes Vendidos</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              {stats.totalItems} <span className="text-xl font-bold opacity-40 ml-1">unid.</span>
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>

                 <motion.div whileHover={{ y: -5 }}>
                   <Card className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative group">
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-purple-500/10 blur-3xl rounded-full group-hover:bg-purple-500/20 transition-all" />
                      <CardContent className="p-10 space-y-4">
                         <div className="h-12 w-12 bg-purple-500/10 rounded-2xl flex items-center justify-center ring-1 ring-purple-500/20">
                            <Users className="h-6 w-6 text-purple-500" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 leading-none">Ticket Médio</p>
                            <h4 className="text-4xl font-black text-white tracking-tighter">
                              <span className="text-xl font-bold opacity-40 mr-1">R$</span>
                              {(stats.totalRevenue / (Object.keys(stats.productSales).length || 1)).toFixed(2)}
                            </h4>
                         </div>
                      </CardContent>
                   </Card>
                 </motion.div>
              </div>

              <div className="space-y-6">
                 <div className="flex items-center justify-between px-2">
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-600">Ranking de Produtos</h3>
                    <div className="h-px flex-1 bg-white/5 mx-6" />
                 </div>
                 <div className="bg-white/[0.02] backdrop-blur-xl border border-white/5 rounded-[48px] overflow-hidden shadow-2xl">
                    <div className="divide-y divide-white/5">
                       {statsLoading ? (
                          <div className="p-32 text-center">
                            <Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-600/40" />
                            <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest mt-4">Calculando dados...</p>
                          </div>
                       ) : Object.keys(stats.productSales).length === 0 ? (
                          <div className="p-32 text-center">
                            <Package className="h-16 w-16 mx-auto opacity-5 text-white mb-6" />
                            <p className="text-[11px] text-slate-600 font-black uppercase tracking-[0.3em]">Nenhum registro de venda</p>
                          </div>
                       ) : (
                          Object.values(stats.productSales)
                            .sort((a, b) => (b as any).count - (a as any).count)
                            .map((item: any, i) => (
                              <motion.div 
                                key={i} 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="flex items-center justify-between p-8 hover:bg-white/[0.03] transition-all group"
                              >
                                 <div className="flex items-center gap-8">
                                    <div className={`h-14 w-14 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg transition-transform group-hover:scale-110 ${
                                      i === 0 ? 'bg-amber-500 text-white shadow-amber-900/20 ring-4 ring-amber-500/10' : 
                                      i === 1 ? 'bg-slate-400 text-white shadow-slate-900/20' :
                                      i === 2 ? 'bg-orange-600 text-white shadow-orange-900/20' :
                                      'bg-slate-800 text-slate-500 ring-1 ring-white/5'
                                    }`}>
                                       {i + 1}
                                    </div>
                                    <div>
                                       <p className="text-lg font-black text-white/90 uppercase tracking-tight mb-0.5">{item.name}</p>
                                       <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">{item.count} unidades vendidas</p>
                                    </div>
                                 </div>
                                 {item.revenue > 0 && (
                                   <div className="text-2xl font-black text-white tracking-tighter">
                                      <span className="text-sm font-bold opacity-40 mr-1">R$</span>
                                      {item.revenue.toFixed(2)}
                                   </div>
                                 )}
                              </motion.div>
                            ))
                       )}
                    </div>
                 </div>
              </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Mobile Control Bar - Premium Refinement */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/80 backdrop-blur-3xl border-t border-white/10 px-6 py-4 lg:hidden safe-area-bottom shadow-[0_-30px_60px_rgba(0,0,0,0.8)]">
        <div className="max-w-md mx-auto space-y-4">
          {scannedUser && (
            <div className="bg-white/5 border border-white/5 p-3 rounded-2xl flex items-center justify-between text-xs mb-1">
              <div className="min-w-0">
                <p className="font-extrabold text-white truncate max-w-[180px] uppercase text-[10px] tracking-wide leading-none mb-1">{scannedUser.name}</p>
                <p className="text-[10px] font-black font-mono text-blue-400 tracking-wide leading-tight mt-0.5">
                  Cartão: {formatCardNumber(scannedUser.uid || (scannedUser as any).scannedCardCode || scannedUser.qrCode || '')}
                </p>
                <p className="text-[8px] font-bold text-slate-500 font-mono leading-none tracking-tight">
                  ID: {(scannedUser as any).scannedCardCode || scannedUser.qrCode || scannedUser.uid}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase text-slate-500 leading-none">Saldo</p>
                <p className="text-sm font-extrabold text-emerald-400 tracking-tight leading-none mt-1">R$ {scannedUser.balance.toFixed(2)}</p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] leading-none">Total Agora</span>
              <div className="text-2xl font-black text-white tracking-tighter">
                <span className="text-sm font-bold opacity-40 mr-1">R$</span>
                {cartTotal.toFixed(2)}
              </div>
            </div>
            {cart.length > 0 && (
              <Button 
                onClick={() => setShowMobileCart(true)}
                variant="ghost" 
                className="h-10 text-[10px] font-black uppercase text-blue-400 bg-blue-500/10 rounded-xl px-4 border border-blue-500/20"
              >
                {cart.reduce((a, b) => a + b.quantity, 0)} Itens • Detalhes
              </Button>
            )}
          </div>
          
          <div className="flex gap-4 h-14">
            <AnimatePresence mode="popLayout">
              {cart.length > 0 && !scannedUser ? (
                <motion.div 
                  key="scan-btn"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1"
                >
                  <Button 
                    onClick={() => setIsScanning(true)} 
                    className="w-full h-full bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs tracking-[0.2em] rounded-[20px] shadow-2xl shadow-blue-500/30 border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all"
                  >
                    <QrCode className="h-5 w-5 mr-3" /> ESCANEAR
                  </Button>
                </motion.div>
              ) : scannedUser ? (
                <motion.div 
                  key="pay-btn-group"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex-1 flex gap-3"
                >
                  <Button 
                    onClick={handleSale}
                    disabled={processing || scannedUser.balance < cartTotal || cart.length === 0}
                    className={`flex-1 h-full font-black uppercase text-xs tracking-widest rounded-[20px] shadow-2xl transition-all ${
                       scannedUser.balance < cartTotal 
                       ? 'bg-slate-800 text-slate-600' 
                       : 'bg-green-600 hover:bg-green-500 shadow-green-600/20 active:translate-y-1'
                    }`}
                  >
                    {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : 
                     scannedUser.balance < cartTotal ? 'SALDO BAIXO' : 'CONFIRMAR'}
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setScannedUser(null)}
                    className="w-14 h-full bg-white/5 rounded-[20px] text-slate-500 hover:text-white border border-white/5"
                  >
                    <XCircle className="h-6 w-6" />
                  </Button>
                </motion.div>
              ) : (
                <motion.div 
                  key="empty-scan"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex-1"
                >
                  <Button 
                    onClick={() => setIsScanning(true)}
                    className="w-full h-full bg-white/5 hover:bg-white/10 text-slate-400 font-extrabold uppercase text-[10px] tracking-widest rounded-[20px] border border-white/10"
                  >
                    <QrCode className="h-5 w-5 mr-3 opacity-50" /> QR CODE
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile Cart Modal */}
      <AnimatePresence>
        {showMobileCart && (
          <div className="fixed inset-0 z-[110] lg:hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileCart(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-slate-900 border-t border-white/10 rounded-t-[48px] overflow-hidden flex flex-col"
            >
              <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto my-4" />
              
              <div className="px-8 pb-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="h-5 w-5 text-blue-400" />
                  <h3 className="font-black text-xs uppercase tracking-widest text-white">Seu Carrinho</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowMobileCart(false)} className="rounded-full text-slate-500">
                  <XCircle className="h-6 w-6" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                {cart.length === 0 ? (
                  <div className="py-20 text-center animate-pulse">
                    <ShoppingCart className="h-12 w-12 mx-auto text-slate-700 mb-4" />
                    <p className="text-[10px] font-black uppercase text-slate-600 tracking-widest">Vazio</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <motion.div 
                      key={item.id}
                      layout
                      className="flex items-center justify-between p-4 bg-white/[0.03] rounded-2xl border border-white/5"
                    >
                      <div className="flex-1 mr-4">
                        <p className="font-black text-[11px] uppercase text-white/90 truncate">{item.name}</p>
                        <p className="text-[10px] text-blue-400 font-bold">R$ {item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl ring-1 ring-white/10">
                          <button onClick={() => removeFromCart(item.id)} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 transition-colors">
                            <Minus size={14} strokeWidth={3}/>
                          </button>
                          <span className="w-6 text-center text-xs font-black tabular-nums">{item.quantity}</span>
                          <button onClick={() => addToCart(item)} className="h-8 w-8 flex items-center justify-center rounded-lg text-blue-400 hover:text-blue-300 transition-colors">
                            <Plus size={14} strokeWidth={3}/>
                          </button>
                        </div>
                        <button 
                          onClick={() => deleteItemFromCart(item.id)}
                          className="h-9 w-9 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              <div className="p-8 bg-slate-950/50 border-t border-white/10 flex flex-col gap-6 safe-area-bottom">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Total</span>
                    <div className="text-4xl font-black text-white tracking-tighter">
                      <span className="text-xl font-bold mr-1 opacity-40">R$</span>
                      {cartTotal.toFixed(2)}
                    </div>
                  </div>
                  <Button onClick={() => setShowMobileCart(false)} className="bg-blue-600 font-black uppercase text-[10px] tracking-widest rounded-xl px-6 h-12 shadow-lg shadow-blue-600/20">
                    ADICIONAR MAIS
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Searching Client Loading Overlay */}
      <AnimatePresence>
        {isSearchingClient && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-slate-900/90 border border-white/10 rounded-[40px] p-8 text-center space-y-6 shadow-2xl overflow-hidden"
            >
              {/* Animated glowing decorative circle */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-blue-500/10 blur-3xl pointer-events-none rounded-full" />
              
              <div className="relative flex justify-center items-center h-32 w-32 mx-auto">
                {/* Double pulse circles */}
                <span className="absolute inline-flex h-24 w-24 rounded-full bg-blue-500/15 animate-ping" />
                <span className="absolute inline-flex h-16 w-16 rounded-full bg-blue-400/20 animate-pulse" />
                
                {/* Rotating ring */}
                <div className="absolute h-28 w-28 rounded-full border-2 border-dashed border-blue-500/45 animate-spin" />
                
                {/* Center search/RFID card icon with floating animation */}
                <motion.div 
                  className="bg-blue-600 h-16 w-16 rounded-2xl flex items-center justify-center text-white shadow-[0_15px_30px_rgba(37,99,235,0.4)] border border-blue-400/30"
                  animate={{ 
                    y: [0, -6, 0],
                    rotate: [0, 5, -5, 0]
                  }}
                  transition={{ 
                    repeat: Infinity, 
                    duration: 2.5,
                    ease: "easeInOut"
                  }}
                >
                  <Search className="h-7 w-7 text-white" />
                </motion.div>
              </div>

              <div className="space-y-2 relative z-10">
                <h3 className="text-lg font-black text-white uppercase tracking-wider">Aguardando Cliente</h3>
                <p className="text-slate-400 text-xs font-semibold">Consultando banco de dados...</p>
              </div>

              <div className="flex items-center justify-center gap-1.5 py-1 px-4 bg-white/5 border border-white/5 rounded-2xl w-fit mx-auto text-[10px] text-slate-500 font-mono">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span>AGUARDANDO RETORNO</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {isScanning && (
        <QRScanner onScan={onScanSuccess} onClose={() => setIsScanning(false)} title="Identificar Cliente" />
      )}

      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-12 md:pt-20">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden mt-4"
            >
              <div className="absolute top-6 right-6">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSelectedOrder(null)}
                  className="rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                >
                  <XCircle className="h-6 w-6" />
                </Button>
              </div>

              <div className="p-8 space-y-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">
                    <Clock className="h-3 w-3" />
                    <span>Detalhes do Pedido</span>
                  </div>
                  <h3 className="text-3xl font-black text-white tracking-tighter">
                    {(selectedOrder as any).studentName}
                  </h3>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    ID: #{selectedOrder.id.slice(-8)}
                  </p>
                </div>

                <div className="bg-white/[0.02] rounded-3xl border border-white/5 p-6 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>Horário da Solicitação</span>
                    <span className="text-white">
                      {selectedOrder.timestamp?.toDate ? 
                        new Intl.DateTimeFormat('pt-BR', { 
                          hour: '2-digit', 
                          minute: '2-digit', 
                          second: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        }).format(selectedOrder.timestamp.toDate()) : 
                        'Data indisponível'
                      }
                    </span>
                  </div>
                  <div className="h-px bg-white/5" />
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Itens Solicitados</p>
                    <div className="space-y-2">
                      {selectedOrder.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5 ring-1 ring-inset ring-white/[0.02]">
                          <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
                          <p className="font-black text-sm uppercase text-white/90 tracking-tight">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-blue-600/10 p-6 rounded-3xl border border-blue-500/20">
                  <span className="text-sm font-black text-blue-400 uppercase tracking-widest">Total Pago</span>
                  <div className="text-3xl font-black text-white tracking-tighter">
                    <span className="text-base font-bold opacity-40 mr-1">R$</span>
                    {selectedOrder.total.toFixed(2)}
                  </div>
                </div>

                <Button 
                  onClick={() => {
                    markAsDelivered(selectedOrder.id);
                    setSelectedOrder(null);
                  }}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs tracking-[0.2em] gap-3 rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-6 w-6" /> CONFIRMAR ENTREGA AGORA
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {statusModal.show && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setStatusModal(prev => ({ ...prev, show: false }))}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden text-center p-8"
            >
              <div className="flex flex-col items-center gap-6">
                <div className={`h-24 w-24 rounded-full flex items-center justify-center ${
                  statusModal.type === 'success' ? 'bg-green-500/10 text-green-500 ring-4 ring-green-500/5' :
                  statusModal.type === 'error' ? 'bg-red-500/10 text-red-500 ring-4 ring-red-500/5' :
                  'bg-blue-500/10 text-blue-500 ring-4 ring-blue-500/5'
                }`}>
                  {statusModal.type === 'success' ? <CheckCircle2 className="h-12 w-12" /> :
                   statusModal.type === 'error' ? <XCircle className="h-12 w-12" /> :
                   <QrCode className="h-12 w-12" />}
                </div>

                <div className="space-y-2 w-full">
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                    {statusModal.title}
                  </h3>
                  <p className="text-slate-400 text-sm font-medium whitespace-pre-wrap leading-relaxed">
                    {statusModal.message}
                  </p>
                </div>

                {statusModal.type === 'success' && statusModal.items && statusModal.items.length > 0 && (
                  <div className="w-full bg-slate-950/60 rounded-3xl border border-white/5 p-4 text-left space-y-3.5 max-h-56 overflow-y-auto">
                    <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider border-b border-white/5 pb-2">
                      Resumo da Venda
                    </p>
                    <div className="space-y-2.5">
                      {statusModal.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-start gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-emerald-400 font-extrabold font-mono text-xs">
                              {item.quantity}x
                            </span>
                            <span className="text-slate-300 font-bold truncate">
                              {item.name}
                            </span>
                          </div>
                          <span className="text-slate-400 font-mono text-xs shrink-0">
                            R$ {(item.price * item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2.5 border-t border-white/5 flex justify-between items-center text-xs font-black">
                      <span className="text-slate-400 uppercase tracking-widest text-[9px]">Total Geral</span>
                      <span className="text-emerald-400 font-mono text-sm font-black">
                        R$ {statusModal.items.reduce((sum, item) => sum + (item.price * item.quantity), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}

                <Button 
                  onClick={() => setStatusModal(prev => ({ ...prev, show: false }))}
                  className={`w-full h-14 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${
                    statusModal.type === 'success' ? 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-600/20' :
                    statusModal.type === 'error' ? 'bg-red-600 hover:bg-red-500 shadow-xl shadow-red-600/20' :
                    'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  Continuar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}


