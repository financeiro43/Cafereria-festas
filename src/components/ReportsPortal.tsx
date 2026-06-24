import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Stall, Product, UserProfile, Transaction, Withdrawal } from '../types';
import { 
  FileText, 
  Download, 
  BarChart3, 
  Table as TableIcon, 
  DollarSign, 
  Users, 
  Store, 
  Package, 
  History,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Search,
  Calendar,
  CheckCircle2,
  QrCode,
  Tag,
  CreditCard,
  ShoppingBag,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowUpDown,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface ReportsPortalProps {
  stalls?: Stall[];
  products?: Product[];
  users?: UserProfile[];
  transactions?: Transaction[];
  withdrawals?: Withdrawal[];
  consumption?: any[];
}

export default function ReportsPortal({ 
  stalls = [], 
  products = [], 
  users = [], 
  transactions = [], 
  withdrawals = [],
  consumption = []
}: ReportsPortalProps) {
  const [reportType, setReportType] = useState<'sales_by_stall' | 'sales_by_product' | 'financial_summary' | 'user_balances' | 'transactions_log' | 'cards_report'>('financial_summary');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cardOriginFilter, setCardOriginFilter] = useState<'all' | 'system' | 'client'>('all');
  const [cardUsageFilter, setCardUsageFilter] = useState<'all' | 'used' | 'unused'>('all');
  const [expandedStall, setExpandedStall] = useState<string | null>(null);

  // Sorting control states
  const [stallSortField, setStallSortField] = useState<'name' | 'sales' | 'volume'>('sales');
  const [stallSortDirection, setStallSortDirection] = useState<'desc' | 'asc'>('desc');

  const [productSortField, setProductSortField] = useState<'name' | 'stall' | 'price' | 'quantity' | 'total'>('total');
  const [productSortDirection, setProductSortDirection] = useState<'desc' | 'asc'>('desc');

  const [balanceSortField, setBalanceSortField] = useState<'name' | 'email' | 'balance'>('balance');
  const [balanceSortDirection, setBalanceSortDirection] = useState<'desc' | 'asc'>('desc');

  const [cardsSortField, setCardsSortField] = useState<'name' | 'email' | 'balance' | 'date'>('date');
  const [cardsSortDirection, setCardsSortDirection] = useState<'desc' | 'asc'>('desc');

  // Detail Modal state for clicking on a listing
  const [selectedDetail, setSelectedDetail] = useState<{
    type: 'product' | 'user' | 'card' | 'stall';
    id: string; // name, uid or barcode/qrcode
    title: string;
    subtitle: string;
  } | null>(null);

  // Helper sorting headers togglers
  const handleStallSort = (field: 'name' | 'sales' | 'volume') => {
    if (stallSortField === field) {
      setStallSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setStallSortField(field);
      setStallSortDirection('desc');
    }
  };

  const handleProductSort = (field: 'name' | 'stall' | 'price' | 'quantity' | 'total') => {
    if (productSortField === field) {
      setProductSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setProductSortField(field);
      setProductSortDirection('desc');
    }
  };

  const handleBalanceSort = (field: 'name' | 'email' | 'balance') => {
    if (balanceSortField === field) {
      setBalanceSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setBalanceSortField(field);
      setBalanceSortDirection('desc');
    }
  };

  const handleCardsSort = (field: 'name' | 'email' | 'balance' | 'date') => {
    if (cardsSortField === field) {
      setCardsSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setCardsSortField(field);
      setCardsSortDirection('desc');
    }
  };

  // Reusable Sortable Column Header Renderer
  const renderSortableHeader = (
    label: string, 
    currentField: string, 
    activeField: string, 
    direction: 'asc' | 'desc', 
    onSort: (field: any) => void,
    alignRight = false
  ) => {
    const isActive = activeField === currentField;
    return (
      <th 
        onClick={() => onSort(currentField)}
        className={`px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 cursor-pointer hover:bg-slate-100 select-none group transition-colors ${alignRight ? 'text-right' : ''}`}
      >
        <div className={`flex items-center gap-1.5 ${alignRight ? 'justify-end' : 'justify-start'}`}>
          <span>{label}</span>
          <div className="shrink-0 transition-opacity">
            {isActive ? (
              direction === 'asc' ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-900" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-900" />
              )
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-60 group-hover:opacity-100" />
            )}
          </div>
        </div>
      </th>
    );
  };

  // Helper to format currency
  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

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

  // Helper to parse "YYYY-MM-DD" local date safely without timezone/UTC offset issues
  const parseLocalDate = (dateStr: string, hour = 0, minute = 0, second = 0, ms = 0) => {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr); // fallback
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // 0-indexed month
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day, hour, minute, second, ms);
  };

  // Helper to parse multiple timestamp formats (Firestore/ISO/Milliseconds) to Date safely
  const getParsedDate = (timestampField: any): Date | null => {
    if (!timestampField) return null;
    if (typeof timestampField.toDate === 'function') {
      return timestampField.toDate();
    }
    if (typeof timestampField.toMillis === 'function') {
      return new Date(timestampField.toMillis());
    }
    if (timestampField.seconds !== undefined) {
      return new Date(timestampField.seconds * 1000);
    }
    const parsed = new Date(timestampField);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // 1. Filtered Sales (Consumption) records
  const filteredSales = useMemo(() => {
    return consumption.filter(s => {
      let isDateMatch = true;
      try {
        const sDate = getParsedDate(s.timestamp);
        if (!sDate || isNaN(sDate.getTime())) return false; // Exclude with invalid timestamp unless all-time
        
        if (startDate) {
          const start = parseLocalDate(startDate, 0, 0, 0, 0);
          if (start) isDateMatch = isDateMatch && sDate >= start;
        }
        if (endDate) {
          const end = parseLocalDate(endDate, 23, 59, 59, 999);
          if (end) isDateMatch = isDateMatch && sDate <= end;
        }
      } catch (e) {
        console.warn("Error parsing sales date", e);
      }
      return isDateMatch;
    });
  }, [consumption, startDate, endDate]);

  // Helper to format date safety
  const formatDate = (timestamp: any) => {
    try {
      if (!timestamp) return 'N/A';
      const date = getParsedDate(timestamp);
      if (!date || isNaN(date.getTime())) return 'Data Inválida';
      return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
    } catch (e) {
      return 'Erro na Data';
    }
  };

  // 1. Transactions filtered by state criteria
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const date = getParsedDate(t.timestamp);
      if (!date || isNaN(date.getTime())) return false; // Exclude with invalid timestamp unless all-time
      
      const isStatusMatch = statusFilter === 'all' || t.status === statusFilter;
      
      let isDateMatch = true;
      if (startDate) {
        const start = parseLocalDate(startDate, 0, 0, 0, 0);
        if (start) isDateMatch = isDateMatch && date >= start;
      }
      if (endDate) {
        const end = parseLocalDate(endDate, 23, 59, 59, 999);
        if (end) isDateMatch = isDateMatch && date <= end;
      }

      let isSearchMatch = true;
      if (searchQuery.trim()) {
        const queryNorm = searchQuery.toLowerCase().trim();
        const user = users.find(u => u.uid === t.userId);
        const nameMatch = (user?.name || '').toLowerCase().includes(queryNorm);
        const emailMatch = (user?.email || '').toLowerCase().includes(queryNorm);
        const descMatch = (t.description || '').toLowerCase().includes(queryNorm);
        const stallMatch = (t.stallName || '').toLowerCase().includes(queryNorm);
        const paymentMatch = (t.paymentMethod || '').toLowerCase().includes(queryNorm);
        const typeMatch = (t.type === 'credit' ? 'carga' : 'compra').includes(queryNorm);
        isSearchMatch = nameMatch || emailMatch || descMatch || stallMatch || paymentMatch || typeMatch;
      }
      
      return isStatusMatch && isDateMatch && isSearchMatch;
    });
  }, [transactions, users, startDate, endDate, statusFilter, searchQuery]);

  // 2. Financial Summary Data
  const financialSummary = useMemo(() => {
    const totalCreditsTransactions = filteredTransactions
      .filter(t => t.type === 'credit' && t.status === 'completed');
    const totalCredits = totalCreditsTransactions
      .reduce((acc, t) => acc + (t.amount || 0), 0);
    const totalCreditsCount = totalCreditsTransactions.length;

    // Online credits: description contains 'Rede' or 'Simulado' or 'Simulada' or 'Online' or contains redeTid
    const onlineCreditsTransactions = totalCreditsTransactions
      .filter(t => 
        t.description?.includes('Rede') || 
        t.description?.includes('Simulado') || 
        t.description?.includes('Simulada') || 
        t.description?.includes('Online') ||
        !!t.redeTid
      );
    const onlineCreditsAmount = onlineCreditsTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
    const onlineCreditsCount = onlineCreditsTransactions.length;

    // Physical credits: manual or vendor/POS recharges
    const physicalCreditsTransactions = totalCreditsTransactions
      .filter(t => !(
        t.description?.includes('Rede') || 
        t.description?.includes('Simulado') || 
        t.description?.includes('Simulada') || 
        t.description?.includes('Online') ||
        !!t.redeTid
      ));
    const physicalCreditsAmount = physicalCreditsTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
    const physicalCreditsCount = physicalCreditsTransactions.length;

    const totalDebits = filteredTransactions
      .filter(t => t.type === 'debit' && t.status === 'completed')
      .reduce((acc, t) => acc + (t.amount || 0), 0);
    
    const totalWithdrawals = withdrawals
      .filter(w => {
        const date = getParsedDate(w.timestamp);
        if (!date || isNaN(date.getTime())) return false;
        let isDateMatch = true;
        if (startDate) {
          const start = parseLocalDate(startDate, 0, 0, 0, 0);
          if (start) isDateMatch = isDateMatch && date >= start;
        }
        if (endDate) {
          const end = parseLocalDate(endDate, 23, 59, 59, 999);
          if (end) isDateMatch = isDateMatch && date <= end;
        }
        return isDateMatch;
      })
      .reduce((acc, w) => acc + (w.amount || 0), 0);

    return [
      { category: 'Total de Cargas', amount: totalCredits, desc: `Dinheiro total inserido no sistema (${totalCreditsCount} recargas)` },
      { category: ' └─ Recargas Online (PWA)', amount: onlineCreditsAmount, desc: `${onlineCreditsCount} cargas concluídas online via Pix ou cartão pelo cliente` },
      { category: ' └─ Recargas Presenciais (Caixa)', amount: physicalCreditsAmount, desc: `${physicalCreditsCount} cargas presenciais efetuadas pelos caixas` },
      { category: 'Total de Consumo', amount: totalDebits, desc: 'Vendas realizadas nas barracas' },
      { category: 'Total de Saques', amount: totalWithdrawals, desc: 'Saques realizados por vendedores' },
      { category: 'Saldo em Circulação', amount: totalCredits - totalDebits, desc: 'Saldo pendente nos cartões' },
    ];
  }, [filteredTransactions, withdrawals, startDate, endDate]);

  const filteredFinancialSummary = useMemo(() => {
    if (!searchQuery.trim()) return financialSummary;
    const queryNorm = searchQuery.toLowerCase().trim();
    return financialSummary.filter(row => 
      row.category.toLowerCase().includes(queryNorm) || 
      row.desc.toLowerCase().includes(queryNorm)
    );
  }, [financialSummary, searchQuery]);

  // Analytics for Recharges by Channel (Online vs Physical/Caixa)
  const rechargeChannelStats = useMemo(() => {
    const totalCreditsTransactions = filteredTransactions
      .filter(t => t.type === 'credit' && t.status === 'completed');
    
    const onlineTxs = totalCreditsTransactions.filter(t => 
      t.description?.includes('Rede') || 
      t.description?.includes('Simulado') || 
      t.description?.includes('Simulada') || 
      t.description?.includes('Online') ||
      !!t.redeTid
    );
    const physicalTxs = totalCreditsTransactions.filter(t => !(
      t.description?.includes('Rede') || 
      t.description?.includes('Simulado') || 
      t.description?.includes('Simulada') || 
      t.description?.includes('Online') ||
      !!t.redeTid
    ));

    const onlineTotal = onlineTxs.reduce((acc, t) => acc + (t.amount || 0), 0);
    const onlineCount = onlineTxs.length;
    const onlineAvg = onlineCount > 0 ? onlineTotal / onlineCount : 0;

    const physicalTotal = physicalTxs.reduce((acc, t) => acc + (t.amount || 0), 0);
    const physicalCount = physicalTxs.length;
    const physicalAvg = physicalCount > 0 ? physicalTotal / physicalCount : 0;

    const granTotal = onlineTotal + physicalTotal;
    const granCount = onlineCount + physicalCount;

    const onlineValPct = granTotal > 0 ? Math.round((onlineTotal / granTotal) * 100) : 0;
    const physicalValPct = granTotal > 0 ? Math.round((physicalTotal / granTotal) * 100) : 0;

    const onlineCountPct = granCount > 0 ? Math.round((onlineCount / granCount) * 100) : 0;
    const physicalCountPct = granCount > 0 ? Math.round((physicalCount / granCount) * 100) : 0;

    return {
      onlineTotal,
      onlineCount,
      onlineAvg,
      onlineValPct,
      onlineCountPct,
      physicalTotal,
      physicalCount,
      physicalAvg,
      physicalValPct,
      physicalCountPct,
      granTotal,
      granCount,
    };
  }, [filteredTransactions]);

  // Analytics for Recharges by Detailed Payment Method
  const paymentMethodsStats = useMemo(() => {
    const completedCredits = filteredTransactions
      .filter(t => t.type === 'credit' && t.status === 'completed');

    const initialMethods = {
      // Online
      'Pix (Online)': { amount: 0, count: 0, type: 'online', label: 'Pix Online', color: 'bg-emerald-500' },
      'Crédito (Online)': { amount: 0, count: 0, type: 'online', label: 'Crédito Online', color: 'bg-teal-500' },
      'Débito (Online)': { amount: 0, count: 0, type: 'online', label: 'Débito Online', color: 'bg-cyan-500' },
      'Outros (Online)': { amount: 0, count: 0, type: 'online', label: 'Outros Online', color: 'bg-sky-500' },
      // Physical / Caixa
      'Dinheiro (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Dinheiro (Caixa)', color: 'bg-amber-500' },
      'Pix (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Pix (Caixa)', color: 'bg-lime-500' },
      'Débito (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Débito (Caixa)', color: 'bg-indigo-505' },
      'Crédito (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Crédito (Caixa)', color: 'bg-violet-500' },
      'Conta (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Conta (Caixa)', color: 'bg-purple-500' },
      'Outros (Caixa)': { amount: 0, count: 0, type: 'physical', label: 'Outros (Caixa)', color: 'bg-pink-500' },
    };

    completedCredits.forEach(t => {
      const amt = t.amount || 0;
      const desc = (t.description || '').toLowerCase();
      
      const isOnline = 
        desc.includes('rede') || 
        desc.includes('simulado') || 
        desc.includes('simulada') || 
        desc.includes('online') ||
        !!t.redeTid;

      let categoryKey: keyof typeof initialMethods;

      if (isOnline) {
        if (desc.includes('pix')) {
          categoryKey = 'Pix (Online)';
        } else if (desc.includes('crédito') || desc.includes('credit')) {
          categoryKey = 'Crédito (Online)';
        } else if (desc.includes('débito') || desc.includes('debit')) {
          categoryKey = 'Débito (Online)';
        } else {
          categoryKey = 'Outros (Online)';
        }
      } else {
        const methodField = t.paymentMethod ? t.paymentMethod.trim() : '';
        const methodLower = methodField.toLowerCase();
        
        if (methodLower === 'dinheiro') {
          categoryKey = 'Dinheiro (Caixa)';
        } else if (methodLower === 'pix') {
          categoryKey = 'Pix (Caixa)';
        } else if (methodLower === 'débito' || methodLower === 'debito') {
          categoryKey = 'Débito (Caixa)';
        } else if (methodLower === 'crédito' || methodLower === 'credito') {
          categoryKey = 'Crédito (Caixa)';
        } else if (methodLower === 'conta') {
          categoryKey = 'Conta (Caixa)';
        } else {
          if (desc.includes('dinheiro')) {
            categoryKey = 'Dinheiro (Caixa)';
          } else if (desc.includes('pix')) {
            categoryKey = 'Pix (Caixa)';
          } else if (desc.includes('débito') || desc.includes('debito')) {
            categoryKey = 'Débito (Caixa)';
          } else if (desc.includes('crédito') || desc.includes('credito')) {
            categoryKey = 'Crédito (Caixa)';
          } else if (desc.includes('conta')) {
            categoryKey = 'Conta (Caixa)';
          } else {
            categoryKey = 'Outros (Caixa)';
          }
        }
      }

      initialMethods[categoryKey].amount += amt;
      initialMethods[categoryKey].count += 1;
    });

    return Object.entries(initialMethods).map(([name, data]) => ({
      name,
      ...data,
    }));
  }, [filteredTransactions]);

  // 5. Sales by Product Data (Aggregates real values & quantities from consumption and transactions)
  const salesByProduct = useMemo(() => {
    // Start with a map populated of all products in the catalogue to support showing items with 0 sales too
    const productMap: { [key: string]: { name: string; price: number; stall: string; quantity: number; totalValue: number } } = {};
    
    products.forEach(p => {
      const stall = stalls.find(s => s.id === p.vendorId);
      const key = `${stall?.name || 'Barraca N/A'}_${p.name}`;
      productMap[key] = {
        name: p.name || 'Produto sem nome',
        price: p.price || 0,
        stall: stall?.name || 'Barraca N/A',
        quantity: 0,
        totalValue: 0
      };
    });

    // Accumulate sales from filteredSales (detailed records)
    filteredSales.forEach(sale => {
      const stall = stalls.find(s => s.id === sale.stallId) || stalls.find(s => s.id === sale.vendorId);
      const stallName = stall?.name || sale.stallName || 'Barraca N/A';

      if (sale.detailedItems && Array.isArray(sale.detailedItems)) {
        sale.detailedItems.forEach((item: any) => {
          const key = `${stallName}_${item.name}`;
          if (!productMap[key]) {
            productMap[key] = {
              name: item.name,
              price: item.price || 0,
              stall: stallName,
              quantity: 0,
              totalValue: 0
            };
          }
          productMap[key].quantity += (item.quantity || 0);
          productMap[key].totalValue += (item.subtotal || (item.price * item.quantity) || 0);
        });
      } else if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((itemStr: string) => {
          const match = itemStr.match(/^(\d+)x\s+(.+)$/);
          if (match) {
            const qty = parseInt(match[1]);
            const name = match[2].trim();
            const key = `${stallName}_${name}`;
            
            if (!productMap[key]) {
              const foundProduct = products.find(p => p.name.toLowerCase() === name.toLowerCase());
              const price = foundProduct ? foundProduct.price : 0;
              productMap[key] = {
                name,
                price,
                stall: stallName,
                quantity: 0,
                totalValue: 0
              };
            }
            productMap[key].quantity += qty;
            productMap[key].totalValue += qty * productMap[key].price;
          }
        });
      }
    });

    // Supplement or Fallback from filteredTransactions if totalSales is zero
    const currentQtySold = Object.values(productMap).reduce((acc, p) => acc + p.quantity, 0);
    if (currentQtySold === 0) {
      const debits = filteredTransactions.filter(t => t.type === 'debit' && t.status === 'completed');
      debits.forEach(t => {
        const stallName = t.stallName || 'Barraca N/A';
        if (t.items && Array.isArray(t.items)) {
          t.items.forEach((itemStr: string) => {
            const match = itemStr.match(/^(\d+)x\s+(.+)$/);
            if (match) {
              const qty = parseInt(match[1]);
              const name = match[2].trim();
              const key = `${stallName}_${name}`;

              if (productMap[key]) {
                 productMap[key].quantity += qty;
                 productMap[key].totalValue += qty * productMap[key].price;
              } else {
                const foundProduct = products.find(p => p.name.toLowerCase() === name.toLowerCase());
                const price = foundProduct ? foundProduct.price : (Math.abs(t.amount) / qty || 0);
                productMap[key] = {
                  name,
                  price,
                  stall: stallName,
                  quantity: qty,
                  totalValue: qty * price
                };
              }
            }
          });
        }
      });
    }

    return Object.values(productMap)
      .filter(row => {
        if (!searchQuery.trim()) return true;
        const queryNorm = searchQuery.toLowerCase().trim();
        return row.name.toLowerCase().includes(queryNorm) || row.stall.toLowerCase().includes(queryNorm);
      })
      .sort((a, b) => {
        let multiplier = productSortDirection === 'asc' ? 1 : -1;
        if (productSortField === 'name') {
          return multiplier * a.name.localeCompare(b.name, 'pt-BR');
        } else if (productSortField === 'stall') {
          return multiplier * a.stall.localeCompare(b.stall, 'pt-BR');
        } else if (productSortField === 'price') {
          return multiplier * (a.price - b.price);
        } else if (productSortField === 'quantity') {
          return multiplier * (a.quantity - b.quantity);
        } else {
          return multiplier * (a.totalValue - b.totalValue);
        }
      });
  }, [products, stalls, filteredSales, filteredTransactions, searchQuery, productSortField, productSortDirection]);

  // 3. Sales by Stall Data
  const salesByStall = useMemo(() => {
    return stalls.map(stall => {
      // 1. Get transaction records matching this stall
      const stallSales = filteredTransactions.filter(t => {
        if (t.type !== 'debit' || t.status !== 'completed') return false;

        // Match stallName or vendorId
        if (t.stallName && t.stallName.toLowerCase().trim() === stall.name.toLowerCase().trim()) return true;
        if (t.vendorId === stall.id) return true;
        if (t.description && t.description.toLowerCase().includes(`na barraca ${stall.name.toLowerCase()}`)) return true;

        return false;
      });

      // 2. Determine total SALES AMOUNT
      // Aggregated items from salesByProduct (which is computed from filteredSales and filteredTransactions)
      const stallItems = salesByProduct.filter(p => p.stall.toLowerCase().trim() === stall.name.toLowerCase().trim());
      const itemsTotalSales = stallItems.reduce((acc, p) => acc + p.totalValue, 0);
      const txsTotalSales = stallSales.reduce((acc, t) => acc + Math.abs(t.amount || 0), 0);
      const totalAmount = itemsTotalSales > 0 ? itemsTotalSales : txsTotalSales;

      // 3. Determine TRANSACTION COUNT (Volume of purchases)
      const consumptionCount = filteredSales.filter(sale => {
        const sStall = stalls.find(s => s.id === sale.stallId) || stalls.find(s => s.id === sale.vendorId);
        return (sStall?.name === stall.name || sale.stallName === stall.name || sale.stallId === stall.id);
      }).length;
      const transactionCount = consumptionCount > 0 ? consumptionCount : stallSales.length;

      return {
        stallName: stall.name || 'Sem nome',
        totalSales: totalAmount,
        transactionCount: transactionCount,
      };
    })
    .filter(row => {
      if (!searchQuery.trim()) return true;
      const queryNorm = searchQuery.toLowerCase().trim();
      return row.stallName.toLowerCase().includes(queryNorm);
    })
    .sort((a, b) => {
      let multiplier = stallSortDirection === 'asc' ? 1 : -1;
      if (stallSortField === 'name') {
        return multiplier * a.stallName.localeCompare(b.stallName, 'pt-BR');
      } else if (stallSortField === 'volume') {
        return multiplier * (a.transactionCount - b.transactionCount);
      } else {
        return multiplier * (a.totalSales - b.totalSales);
      }
    });
  }, [stalls, filteredTransactions, filteredSales, salesByProduct, searchQuery, stallSortField, stallSortDirection]);

  // 4. Transactions Log mapped and filtered
  const transactionsLog = useMemo(() => {
    return [...filteredTransactions]
      .sort((a, b) => {
        const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
        const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
        const timeA = dateA instanceof Date && !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
        const timeB = dateB instanceof Date && !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
        return timeB - timeA;
      })
      .map(t => {
        const user = users.find(u => u.uid === t.userId);
        let stall = t.stallName || 'N/A';
        if (stall === 'N/A' && t.description && t.description.includes('na barraca ')) {
          const match = t.description.match(/na barraca ([^:]+):?/);
          if (match) stall = match[1];
        }
        
        return {
          date: formatDate(t.timestamp),
          user: user?.name || t.userName || 'Sistema',
          cardNumber: formatCardNumber(t.cardNumber || user?.qrCode || t.userId || ''),
          type: t.type === 'credit' ? 'CARGA' : 'COMPRA',
          status: t.status || 'completed',
          amount: t.amount || 0,
          stall: stall,
          paymentMethod: t.paymentMethod || 'N/A',
          desc: t.description || ''
        };
      });
  }, [filteredTransactions, users]);



  // 6. User Balances
  const userBalances = useMemo(() => {
    return users
      .filter(u => u.role === 'student' || u.role === 'admin')
      .map(u => {
        let registrationDate = 0;
        if (u.timestamp) {
          const dt = u.timestamp.toDate ? u.timestamp.toDate() : new Date(u.timestamp);
          if (dt instanceof Date && !isNaN(dt.getTime())) registrationDate = dt.getTime();
        } else if (u.consentedToTermsAt) {
          const dt = new Date(u.consentedToTermsAt);
          if (!isNaN(dt.getTime())) registrationDate = dt.getTime();
        }

        return {
          uid: u.uid,
          name: u.name || 'Sem nome',
          email: u.email || 'N/A',
          balance: u.balance || 0,
          role: u.role === 'student' ? 'Cliente' : 'Admin',
          registrationDate
        };
      })
      .filter(row => {
        // Date match (apply to register date if selected)
        let isDateMatch = true;
        if (startDate && row.registrationDate) {
          const start = parseLocalDate(startDate, 0, 0, 0, 0);
          if (start) isDateMatch = isDateMatch && row.registrationDate >= start.getTime();
        }
        if (endDate && row.registrationDate) {
          const end = parseLocalDate(endDate, 23, 59, 59, 999);
          if (end) isDateMatch = isDateMatch && row.registrationDate <= end.getTime();
        }
        if (!isDateMatch) return false;

        if (!searchQuery.trim()) return true;
        const queryNorm = searchQuery.toLowerCase().trim();
        return row.name.toLowerCase().includes(queryNorm) || row.email.toLowerCase().includes(queryNorm);
      })
      .sort((a, b) => {
        let multiplier = balanceSortDirection === 'asc' ? 1 : -1;
        if (balanceSortField === 'name') {
          return multiplier * a.name.localeCompare(b.name, 'pt-BR');
        } else if (balanceSortField === 'email') {
          return multiplier * a.email.localeCompare(b.email, 'pt-BR');
        } else {
          return multiplier * (a.balance - b.balance);
        }
      });
  }, [users, searchQuery, startDate, endDate, balanceSortField, balanceSortDirection]);

  // 7. Cards Activation Report: System-generated vs Online Client-generated
  const cardsReport = useMemo(() => {
    return users
      .filter(u => u.role === 'student' || u.isPhysicalCard)
      .map(u => {
        let creationDate = 'N/A';
        let timestampMillis = 0;
        
        if (u.timestamp) {
          const dt = u.timestamp.toDate ? u.timestamp.toDate() : new Date(u.timestamp);
          if (dt instanceof Date && !isNaN(dt.getTime())) {
            creationDate = format(dt, 'dd/MM/yyyy HH:mm', { locale: ptBR });
            timestampMillis = dt.getTime();
          }
        } else if (u.consentedToTermsAt) {
          const dt = new Date(u.consentedToTermsAt);
          if (!isNaN(dt.getTime())) {
            creationDate = format(dt, 'dd/MM/yyyy HH:mm', { locale: ptBR });
            timestampMillis = dt.getTime();
          }
        }

        const userRecharges = transactions.filter(
          t => t.userId === u.uid && t.type === 'credit' && t.status === 'completed'
        );
        const hasRecharge = userRecharges.length > 0;
        const rechargeCount = userRecharges.length;
        const totalRecharged = userRecharges.reduce((acc, r) => acc + (r.amount || 0), 0);

        return {
          uid: u.uid,
          name: u.name || 'Sem nome',
          email: u.email || 'N/A',
          qrCode: u.qrCode || u.uid,
          balance: u.balance || 0,
          isPhysical: !!u.isPhysicalCard,
          origin: u.isPhysicalCard ? 'Sistema (Físico)' : 'Online (Cliente)',
          dateStr: creationDate,
          timestampMillis: timestampMillis,
          hasRecharge,
          rechargeCount,
          totalRecharged
        };
      })
      .filter(row => {
        // Apply date limits (by registration) if supplied
        let isDateMatch = true;
        if (startDate && row.timestampMillis) {
          const start = parseLocalDate(startDate, 0, 0, 0, 0);
          if (start) isDateMatch = isDateMatch && row.timestampMillis >= start.getTime();
        }
        if (endDate && row.timestampMillis) {
          const end = parseLocalDate(endDate, 23, 59, 59, 999);
          if (end) isDateMatch = isDateMatch && row.timestampMillis <= end.getTime();
        }
        if (!isDateMatch) return false;

        // Source/Origin filter
        if (cardOriginFilter === 'system' && !row.isPhysical) return false;
        if (cardOriginFilter === 'client' && row.isPhysical) return false;

        // Usage filter
        if (cardUsageFilter === 'used' && !row.hasRecharge) return false;
        if (cardUsageFilter === 'unused' && row.hasRecharge) return false;

        // Search filter
        if (!searchQuery.trim()) return true;
        const queryNorm = searchQuery.toLowerCase().trim();
        return (
          row.name.toLowerCase().includes(queryNorm) ||
          row.email.toLowerCase().includes(queryNorm) ||
          row.qrCode.toLowerCase().includes(queryNorm) ||
          row.origin.toLowerCase().includes(queryNorm)
        );
      })
      .sort((a, b) => {
        let multiplier = cardsSortDirection === 'asc' ? 1 : -1;
        if (cardsSortField === 'name') {
          return multiplier * a.name.localeCompare(b.name, 'pt-BR');
        } else if (cardsSortField === 'email') {
          return multiplier * a.email.localeCompare(b.email, 'pt-BR');
        } else if (cardsSortField === 'balance') {
          return multiplier * (a.balance - b.balance);
        } else {
          return multiplier * (a.timestampMillis - b.timestampMillis);
        }
      });
  }, [users, cardOriginFilter, cardUsageFilter, searchQuery, transactions, startDate, endDate, cardsSortField, cardsSortDirection]);

  // Dynamic Metrics Cards (Totalizadores) calculation
  const kpis = useMemo(() => {
    switch (reportType) {
      case 'financial_summary': {
        const credits = filteredTransactions
          .filter(t => t.type === 'credit' && t.status === 'completed')
          .reduce((acc, t) => acc + (t.amount || 0), 0);
        
        const debits = filteredTransactions
          .filter(t => t.type === 'debit' && t.status === 'completed')
          .reduce((acc, t) => acc + (t.amount || 0), 0);
        
        const tWithdrawals = withdrawals.reduce((acc, w) => acc + (w.amount || 0), 0);

        return [
          { label: 'Total Carregado', value: formatCurrency(credits), text: 'Saldo inserido no sistema', type: 'success' },
          { label: 'Total Consumido', value: formatCurrency(debits), text: 'Vendas das barracas', type: 'info' },
          { label: 'Saldo em Circulação', value: formatCurrency(Math.max(0, credits - debits)), text: 'Bandeira retida nos cartões', type: 'warning' },
          { label: 'Total de Saques', value: formatCurrency(tWithdrawals), text: 'Resgates efetuados', type: 'danger' },
        ];
      }
      case 'sales_by_stall': {
        const totalVendas = salesByStall.reduce((acc, s) => acc + s.totalSales, 0);
        const totalTxs = salesByStall.reduce((acc, s) => acc + s.transactionCount, 0);
        const ticketMedio = totalTxs > 0 ? totalVendas / totalTxs : 0;
        const topStall = salesByStall[0]?.stallName || 'N/A';

        return [
          { label: 'Faturamento Geral', value: formatCurrency(totalVendas), text: 'Vendido nas barracas', type: 'success' },
          { label: 'Volume de Pedidos', value: `${totalTxs} compras`, text: 'Transações registradas', type: 'info' },
          { label: 'Ticket Médio/Compra', value: formatCurrency(ticketMedio), text: 'Ticket médio gasto', type: 'warning' },
          { label: 'Líder de Vendas', value: topStall, text: 'Barraca com maior receita', type: 'danger' },
        ];
      }
      case 'transactions_log': {
        const totalCount = transactionsLog.length;
        const creditsSum = filteredTransactions.filter(t => t.type === 'credit' && t.status === 'completed').reduce((acc, t) => acc + t.amount, 0);
        const debitsSum = filteredTransactions.filter(t => t.type === 'debit' && t.status === 'completed').reduce((acc, t) => acc + t.amount, 0);
        const failCount = filteredTransactions.filter(t => t.status === 'failed').length;

        return [
          { label: 'Transações Filtradas', value: `${totalCount} txs`, text: 'Filtradas pela busca atual', type: 'success' },
          { label: 'Total Entradas (+)', value: formatCurrency(creditsSum), text: 'Soma de cargas ativas', type: 'info' },
          { label: 'Total Saídas (-)', value: formatCurrency(debitsSum), text: 'Soma de consumos locais', type: 'warning' },
          { label: 'Transações com Falha', value: `${failCount} registros`, text: 'Não concluídas com sucesso', type: 'danger' },
        ];
      }
      case 'user_balances': {
        const totalUsers = userBalances.length;
        const walletsSum = userBalances.reduce((acc, u) => acc + u.balance, 0);
        const averageBal = totalUsers > 0 ? walletsSum / totalUsers : 0;
        const highestBal = userBalances.reduce((max, u) => u.balance > max ? u.balance : max, 0);

        return [
          { label: 'Clientes Ativos', value: `${totalUsers} carteiras`, text: 'Base de usuários ativa', type: 'success' },
          { label: 'Saldos Totais PWA', value: formatCurrency(walletsSum), text: 'Créditos custodiados', type: 'info' },
          { label: 'Saldo Médio por Conta', value: formatCurrency(averageBal), text: 'Média de créditos/usuário', type: 'warning' },
          { label: 'Maior Caixa Individual', value: formatCurrency(highestBal), text: 'Maior carteira do sistema', type: 'danger' },
        ];
      }
      case 'sales_by_product': {
        const totalProdCount = salesByProduct.length;
        const totalItemsSold = salesByProduct.reduce((acc, p) => acc + p.quantity, 0);
        const totalFaturamento = salesByProduct.reduce((acc, p) => acc + p.totalValue, 0);
        
        // Find product with largest quantity sold
        const sortedByQty = [...salesByProduct].sort((a, b) => b.quantity - a.quantity);
        const bestSeller = sortedByQty[0]?.quantity > 0 ? `${sortedByQty[0].name} (${sortedByQty[0].quantity} un.)` : 'Nenhum';

        return [
          { label: 'Faturamento Total', value: formatCurrency(totalFaturamento), text: 'Valor gerado por produtos', type: 'success' },
          { label: 'Unidades Vendidas', value: `${totalItemsSold} un.`, text: 'Total de produtos servidos', type: 'info' },
          { label: 'Mais Vendido (Qtd)', value: bestSeller, text: 'Líder do cardápio', type: 'warning' },
          { label: 'Produtos Ativos', value: `${totalProdCount} itens`, text: 'Modelos no catálogo', type: 'danger' },
        ];
      }
      case 'cards_report': {
        const totalCards = cardsReport.length;
        const pCards = cardsReport.filter(c => c.isPhysical).length;
        const vCards = cardsReport.filter(c => !c.isPhysical).length;
        const totalBal = cardsReport.reduce((acc, c) => acc + c.balance, 0);
        
        const utilizedCount = cardsReport.filter(c => c.hasRecharge).length;
        const utilizationPct = totalCards > 0 ? Math.round((utilizedCount / totalCards) * 100) : 0;

        return [
          { label: 'Total de Cartões', value: `${totalCards} ativos`, text: 'Soma de físico mais online', type: 'success' },
          { label: 'Cartões Utilizados', value: `${utilizedCount} usados`, text: `${utilizationPct}% realizaram recarga`, type: 'info' },
          { label: 'Gerados p/ Sistema (Físicos)', value: `${pCards} cartões`, text: 'Impressos ou via ADM', type: 'warning' },
          { label: 'Saldo Retido em Cartões', value: formatCurrency(totalBal), text: 'Total financeiro sob custódia', type: 'danger' },
        ];
      }
      default:
        return [];
    }
  }, [reportType, filteredTransactions, withdrawals, salesByStall, transactionsLog, userBalances, salesByProduct, cardsReport]);

  const exportToExcel = () => {
    try {
      let data: any[] = [];
      let filename = 'relatorio';

      if (reportType === 'financial_summary') {
        data = filteredFinancialSummary.map(row => ({
          'Categoria': row.category,
          'Valor (R$)': typeof row.amount === 'number' ? row.amount : Number(row.amount || 0),
          'Descrição': row.desc
        }));
        filename = 'resumo_financeiro';
      } else if (reportType === 'sales_by_stall') {
        const expandedRows: any[] = [];
        salesByStall.forEach(stallRow => {
          const stallItems = salesByProduct.filter(p => p.stall.toLowerCase().trim() === stallRow.stallName.toLowerCase().trim() && p.quantity > 0);
          if (stallItems.length === 0) {
            expandedRows.push({
              'Barraca': stallRow.stallName,
              'Produto': 'Sem vendas de produtos',
              'Preço Unitário (R$)': 0,
              'Qtd Vendida': 0,
              'Faturamento do Produto (R$)': 0,
              'Faturamento Total da Barraca (R$)': stallRow.totalSales,
              'Total de Compras': stallRow.transactionCount
            });
          } else {
            stallItems.forEach(item => {
              expandedRows.push({
                'Barraca': stallRow.stallName,
                'Produto': item.name,
                'Preço Unitário (R$)': item.price,
                'Qtd Vendida': item.quantity,
                'Faturamento do Produto (R$)': item.totalValue,
                'Faturamento Total da Barraca (R$)': stallRow.totalSales,
                'Total de Compras': stallRow.transactionCount
              });
            });
          }
        });
        data = expandedRows;
        filename = 'vendas_por_barraca';
      } else if (reportType === 'user_balances') {
        data = userBalances.map(row => ({
          'Nome': row.name,
          'Email': row.email,
          'Saldo Atual (R$)': typeof row.balance === 'number' ? row.balance : Number(row.balance || 0)
        }));
        filename = 'saldos_clientes';
      } else if (reportType === 'sales_by_product') {
        data = salesByProduct.map(row => ({
          'Produto': row.name,
          'Barraca': row.stall,
          'Preço Unitário (R$)': typeof row.price === 'number' ? row.price : Number(row.price || 0),
          'Qtd Vendida': row.quantity || 0,
          'Faturamento Total (R$)': typeof row.totalValue === 'number' ? row.totalValue : Number(row.totalValue || 0)
        }));
        filename = 'vendas_por_produto';
      } else if (reportType === 'transactions_log') {
        data = transactionsLog.map(row => ({
          'Data': row.date,
          'Usuário': row.user,
          'Cartão / Código': row.cardNumber || '',
          'Tipo': row.type,
          'Meio': row.paymentMethod,
          'Valor (R$)': typeof row.amount === 'number' ? row.amount : Number(row.amount || 0),
          'Barraca/Ponto': row.stall,
          'Descrição': row.desc
        }));
        filename = 'log_transacoes';
      } else if (reportType === 'cards_report') {
        data = cardsReport.map(row => ({
          'Nome': row.name,
          'Email': row.email,
          'Número do Cartão': formatCardNumber(row.uid || row.qrCode),
          'QR Code / ID': row.qrCode,
          'Origem': row.origin,
          'Status de Uso': row.hasRecharge ? `Utilizado (${row.rechargeCount} recargas)` : 'Apenas Ativado',
          'Total Recarregado (R$)': typeof row.totalRecharged === 'number' ? row.totalRecharged : Number(row.totalRecharged || 0),
          'Saldo (R$)': typeof row.balance === 'number' ? row.balance : Number(row.balance || 0),
          'Data de Cadastro': row.dateStr
        }));
        filename = 'registro_de_cartoes';
      }

      const ws = XLSX.utils.json_to_sheet(data);

      // Apply Excel currency format to monetary columns dynamically
      if (ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let col = range.s.c; col <= range.e.c; col++) {
          const headerAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
          const headerCell = ws[headerAddress];
          if (headerCell && typeof headerCell.v === 'string') {
            const headerText = headerCell.v;
            // Check if column is a money column
            const isMonetary = 
              headerText.includes('(R$)') || 
              headerText.includes('Valor') || 
              headerText.includes('Preço') || 
              headerText.includes('Saldo') || 
              headerText.includes('Total') || 
              headerText.includes('Faturamento');

            if (isMonetary) {
              for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                const cell = ws[cellAddress];
                if (cell && typeof cell.v === 'number') {
                  cell.t = 'n';
                  cell.z = '"R$ " #,##0.00'; // Standard Excel currency format for BRL
                }
              }
            }
          }
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Dados");
      XLSX.writeFile(wb, `${filename}_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`);
      toast.success('Excel exportado com sucesso!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao exportar para Excel');
    }
  };

  const exportToPDF = () => {
    try {
      const doc = new jsPDF();
      const title = reportType.replace(/_/g, ' ').toUpperCase();
      
      doc.setFontSize(18);
      doc.text('FESTA PASS - INTELIGÊNCIA EM EVENTOS', 14, 20);
      doc.setFontSize(14);
      doc.text(title, 14, 30);
      doc.setFontSize(10);
      doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 38);

      let head: string[][] = [];
      let body: any[][] = [];

      if (reportType === 'financial_summary') {
        head = [['Categoria', 'Valor (R$)', 'Descrição']];
        body = filteredFinancialSummary.map(row => [row.category, formatCurrency(row.amount), row.desc]);
      } else if (reportType === 'sales_by_stall') {
        head = [['Barraca', 'Produto', 'Preço Unitário', 'Qtd Vendida', 'Total Prod (R$)', 'Total Barraca (R$)', 'Compras']];
        const rows: any[][] = [];
        salesByStall.forEach(stallRow => {
          const stallItems = salesByProduct.filter(p => p.stall.toLowerCase().trim() === stallRow.stallName.toLowerCase().trim() && p.quantity > 0);
          if (stallItems.length === 0) {
            rows.push([
              stallRow.stallName,
              'Sem vendas no período',
              formatCurrency(0),
              '0 un.',
              formatCurrency(0),
              formatCurrency(stallRow.totalSales),
              stallRow.transactionCount.toString()
            ]);
          } else {
            stallItems.forEach((item, itemIdx) => {
              rows.push([
                itemIdx === 0 ? stallRow.stallName : '', // Show stall name on the first line of the stall group
                item.name,
                formatCurrency(item.price),
                `${item.quantity} un.`,
                formatCurrency(item.totalValue),
                itemIdx === 0 ? formatCurrency(stallRow.totalSales) : '', // Show total on the first line
                itemIdx === 0 ? stallRow.transactionCount.toString() : '' // Show transactions count on the first line
              ]);
            });
          }
        });
        body = rows;
      } else if (reportType === 'user_balances') {
        head = [['Nome', 'Email', 'Saldo Atual (R$)']];
        body = userBalances.map(row => [row.name, row.email, formatCurrency(row.balance)]);
      } else if (reportType === 'sales_by_product') {
        head = [['Produto', 'Barraca', 'Preço Unitário', 'Qtd Vendida', 'Total Faturado']];
        body = salesByProduct.map(row => [
          row.name,
          row.stall,
          formatCurrency(row.price),
          `${row.quantity || 0} un.`,
          formatCurrency(row.totalValue || 0)
        ]);
      } else if (reportType === 'transactions_log') {
        head = [['Data', 'Usuário', 'Cartão', 'Tipo', 'Meio', 'Valor', 'Barraca']];
        body = transactionsLog.map(row => [
          row.date,
          row.user,
          row.cardNumber || '',
          row.type,
          row.paymentMethod,
          formatCurrency(row.amount),
          row.stall
        ]);
      } else if (reportType === 'cards_report') {
        head = [['Nome', 'Email', 'Nº Cartão', 'QR Code', 'Uso', 'Total Recarregado', 'Origem', 'Saldo (R$)', 'Cadastro']];
        body = cardsReport.map(row => [
          row.name, 
          row.email, 
          formatCardNumber(row.uid || row.qrCode),
          row.qrCode, 
          row.hasRecharge ? `Utilizado (${row.rechargeCount}x)` : 'Apenas Ativado',
          formatCurrency(row.totalRecharged),
          row.origin, 
          formatCurrency(row.balance), 
          row.dateStr
        ]);
      }

      autoTable(doc, {
        head: head,
        body: body,
        startY: 45,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      });

      doc.save(`${reportType}_${format(new Date(), 'yyyy-MM-dd_HHmm')}.pdf`);
      toast.success('PDF exportado com sucesso!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao gerar PDF');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Upper header section */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-slate-100">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Business Intelligence</span>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-slate-950 flex items-center justify-center text-white shadow-lg shrink-0">
              <FileText className="h-6 w-6" />
            </div>
            PAINEL DE RELATÓRIOS
          </h2>
          <p className="text-slate-500 font-medium">
            Métricas estratégicas e controle inteligente para o seu evento.
          </p>
        </div>
      </header>

      {/* Advanced dynamic filters section */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-4">
          
          {/* Dynamic Search */}
          <div className="flex flex-col gap-1.5 w-full md:w-64">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Pesquisar geral</label>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Pesquisar por texto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-bold text-slate-705 outline-none focus:ring-2 focus:ring-slate-950/10 w-full"
              />
            </div>
          </div>

          {/* Start Date */}
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Período de Início</label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10"
            />
          </div>

          {/* End Date */}
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Período de Término</label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10"
            />
          </div>

          {/* Transaction status filter */}
          {reportType === 'transactions_log' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Filtro de Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10 min-w-[130px] h-[34px]"
              >
                <option value="all">Todos Status</option>
                <option value="completed">Concluídos</option>
                <option value="pending">Pendentes</option>
                <option value="failed">Falhos</option>
              </select>
            </div>
          )}

          {/* Card Origin filter */}
          {reportType === 'cards_report' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Origem do Cartão</label>
              <select
                value={cardOriginFilter}
                onChange={(e) => setCardOriginFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10 min-w-[160px] h-[34px]"
              >
                <option value="all">Todas as Origens</option>
                <option value="system">Sistema (Físico/Caixa)</option>
                <option value="client">Online (Cliente PWA)</option>
              </select>
            </div>
          )}

          {/* Card Usage filter */}
          {reportType === 'cards_report' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Uso do Cartão</label>
              <select
                value={cardUsageFilter}
                onChange={(e) => setCardUsageFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10 min-w-[185px] h-[34px]"
              >
                <option value="all">Todos os Cartões</option>
                <option value="used">Utilizados (Mín. 1 recarga)</option>
                <option value="unused">Não Utilizados (Sem recarga)</option>
              </select>
            </div>
          )}

          {/* Clear button */}
          {(startDate || endDate || statusFilter !== 'all' || cardOriginFilter !== 'all' || cardUsageFilter !== 'all' || searchQuery) && (
            <Button 
              variant="ghost" 
              onClick={() => { 
                setStartDate(''); 
                setEndDate(''); 
                setStatusFilter('all'); 
                setCardOriginFilter('all');
                setCardUsageFilter('all');
                setSearchQuery('');
              }}
              className="h-10 self-end mt-4 text-[10px] font-black uppercase text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl"
            >
              Resetar Filtros
            </Button>
          )}

          {/* Export tools */}
          <div className="flex gap-2.5 ml-auto self-end mt-4 sm:mt-0">
            <Button 
              onClick={exportToPDF}
              variant="outline"
              className="rounded-xl border-slate-200 font-bold text-xs uppercase tracking-wider h-10 px-4 hover:bg-slate-50 text-slate-700"
            >
              <Download className="h-4 w-4 mr-2 text-slate-500" /> Exportar PDF
            </Button>
            <Button 
              onClick={exportToExcel}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider h-10 px-4 shadow-md shadow-emerald-700/10"
            >
              <TableIcon className="h-4 w-4 mr-2" /> Exportar Excel
            </Button>
          </div>
        </div>
      </div>

      {/* Analytics Sum-up Metric Scorecards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, idx) => {
          let cardStyle = 'border-slate-100 bg-white';
          let iconBadgeStyle = 'bg-slate-100 text-slate-800';
          
          if (kpi.type === 'success') {
            cardStyle = 'border-emerald-100 bg-emerald-50/20';
            iconBadgeStyle = 'bg-emerald-500/10 text-emerald-600';
          } else if (kpi.type === 'info') {
            cardStyle = 'border-blue-100 bg-blue-50/20';
            iconBadgeStyle = 'bg-blue-500/10 text-blue-600';
          } else if (kpi.type === 'warning') {
            cardStyle = 'border-amber-100 bg-amber-50/20';
            iconBadgeStyle = 'bg-amber-500/10 text-amber-600';
          } else if (kpi.type === 'danger') {
            cardStyle = 'border-rose-100 bg-rose-50/20';
            iconBadgeStyle = 'bg-rose-500/10 text-rose-600';
          }

          return (
            <Card key={idx} className={`shadow-sm rounded-3xl border ${cardStyle} overflow-hidden hover:scale-[1.01] transition-transform duration-200`}>
              <CardContent className="p-6 flex justify-between items-center relative">
                <div className="space-y-1 flex-1 min-w-0">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest block">{kpi.label}</span>
                  <h4 className="text-2xl font-black text-slate-900 tracking-tight truncate">{kpi.value}</h4>
                  <p className="text-[10px] text-slate-450 font-semibold leading-normal mt-0.5 truncate text-slate-500">{kpi.text}</p>
                </div>
                
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${iconBadgeStyle}`}>
                  {reportType === 'financial_summary' && idx === 0 && <DollarSign className="h-5 w-5" />}
                  {reportType === 'financial_summary' && idx === 1 && <ShoppingBag className="h-5 w-5" />}
                  {reportType === 'financial_summary' && idx === 2 && <TrendingUp className="h-5 w-5" />}
                  {reportType === 'financial_summary' && idx === 3 && <TrendingDown className="h-5 w-5" />}

                  {reportType === 'sales_by_stall' && idx === 0 && <Store className="h-5 w-5" />}
                  {reportType === 'sales_by_stall' && idx === 1 && <History className="h-5 w-5" />}
                  {reportType === 'sales_by_stall' && idx === 2 && <TrendingUp className="h-5 w-5" />}
                  {reportType === 'sales_by_stall' && idx === 3 && <CheckCircle2 className="h-5 w-5" />}

                  {reportType === 'transactions_log' && idx === 0 && <History className="h-5 w-5" />}
                  {reportType === 'transactions_log' && idx === 1 && <ArrowUpRight className="h-5 w-5" />}
                  {reportType === 'transactions_log' && idx === 2 && <ArrowDownLeft className="h-5 w-5" />}
                  {reportType === 'transactions_log' && idx === 3 && <CheckCircle2 className="h-5 w-5" />}

                  {reportType === 'user_balances' && idx === 0 && <Users className="h-5 w-5" />}
                  {reportType === 'user_balances' && idx === 1 && <Users className="h-5 w-5" />}
                  {reportType === 'user_balances' && idx === 2 && <TrendingUp className="h-5 w-5" />}
                  {reportType === 'user_balances' && idx === 3 && <DollarSign className="h-5 w-5" />}

                  {reportType === 'sales_by_product' && idx === 0 && <Package className="h-5 w-5" />}
                  {reportType === 'sales_by_product' && idx === 1 && <Tag className="h-5 w-5" />}
                  {reportType === 'sales_by_product' && idx === 2 && <TrendingUp className="h-5 w-5" />}
                  {reportType === 'sales_by_product' && idx === 3 && <Store className="h-5 w-5" />}

                  {reportType === 'cards_report' && idx === 0 && <CreditCard className="h-5 w-5" />}
                  {reportType === 'cards_report' && idx === 1 && <Users className="h-5 w-5" />}
                  {reportType === 'cards_report' && idx === 2 && <QrCode className="h-5 w-5" />}
                  {reportType === 'cards_report' && idx === 3 && <DollarSign className="h-5 w-5" />}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main reports dashboard layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Navigation Sidebar */}
        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 px-2">Categorias de Relatórios</p>
            <nav className="space-y-1.5">
              {[
                { id: 'financial_summary', label: 'Resumo Financeiro', icon: DollarSign },
                { id: 'sales_by_stall', label: 'Vendas/Barraca', icon: Store },
                { id: 'transactions_log', label: 'Histórico de Vendas', icon: History },
                { id: 'cards_report', label: 'Ativação de Cartões', icon: CreditCard, subtitle: 'Físico vs Online' },
                { id: 'user_balances', label: 'Saldos Atuais', icon: Users },
                { id: 'sales_by_product', label: 'Vendas por Produto', icon: Package },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => setReportType(type.id as any)}
                  className={`w-full flex items-center justify-between p-3.5 rounded-xl transition-all border text-left ${
                    reportType === type.id 
                      ? 'bg-slate-950 text-white border-slate-950 shadow-md translate-x-1' 
                      : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50 hover:text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <type.icon className={`h-4.5 w-4.5 shrink-0 ${reportType === type.id ? 'text-white' : 'text-slate-400'}`} />
                    <div className="leading-tight">
                      <span className="font-bold text-sm block">{type.label}</span>
                      {type.subtitle && (
                        <span className={`text-[9px] font-black uppercase tracking-wider block mt-0.5 ${reportType === type.id ? 'text-white/70' : 'text-slate-400'}`}>{type.subtitle}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </nav>
          </div>

          <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100 space-y-3 shadow-sm">
            <div className="flex items-center gap-2 text-blue-700">
               <TrendingUp className="h-4 w-4 shrink-0" />
               <span className="text-xs font-black uppercase tracking-wider">Análise de Canal</span>
            </div>
            <p className="text-xs text-blue-600 leading-relaxed font-semibold">
              O relatório <strong>Ativação de Cartões</strong> ajuda você a comparar se os clientes preferem ativar uma conta online pelo PWA ou se preferem cartões impressos pelo caixa.
            </p>
          </div>
        </div>

        {/* Database Grid Content Card */}
        <div className="lg:col-span-3">
          <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden bg-white">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {reportType === 'financial_summary' && 'Resumo Financeiro Consolidado'}
                    {reportType === 'sales_by_stall' && 'Desempenho por Ponto de Venda'}
                    {reportType === 'transactions_log' && 'Histórico de Vendas Detalhado'}
                    {reportType === 'user_balances' && 'Relatório de Créditos Ativos'}
                    {reportType === 'sales_by_product' && 'Desempenho de Vendas por Produto'}
                    {reportType === 'cards_report' && 'Ativação de Cartões (Físico vs Online)'}
                  </CardTitle>
                  <CardDescription className="font-semibold mt-1">
                    Visualização de dados refinada com filtros dinâmicos de texto e período.
                  </CardDescription>

                  {/* Active date range in header for all reports */}
                  <div className="flex items-center gap-1.5 mt-2.5 bg-slate-950 text-white px-3 py-1 rounded-md text-[10px] font-black w-fit uppercase tracking-wider">
                    <Calendar className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span>
                      Período: {startDate ? format(new Date(startDate + 'T00:00:00'), 'dd/MM/yyyy') : 'Todo o Histórico'} 
                      {endDate ? ` até ${format(new Date(endDate + 'T23:59:59'), 'dd/MM/yyyy')}` : ''}
                    </span>
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Sincronizado há pouco</span>
                  <span className="text-xs font-bold text-slate-600">{format(new Date(), 'HH:mm:ss')}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto min-w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      {reportType === 'financial_summary' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Indicador</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Descrição</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Valor</th>
                        </>
                      )}
                      {reportType === 'sales_by_stall' && (
                        <>
                          {renderSortableHeader('Barraca / PDV', 'name', stallSortField, stallSortDirection, handleStallSort)}
                          {renderSortableHeader('Volume', 'volume', stallSortField, stallSortDirection, handleStallSort, true)}
                          {renderSortableHeader('Total Acumulado', 'sales', stallSortField, stallSortDirection, handleStallSort, true)}
                        </>
                      )}
                      {reportType === 'transactions_log' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Horário</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Usuário</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Meio</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Barraca</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Valor</th>
                        </>
                      )}
                      {reportType === 'user_balances' && (
                        <>
                          {renderSortableHeader('Nome do Titular', 'name', balanceSortField, balanceSortDirection, handleBalanceSort)}
                          {renderSortableHeader('E-mail', 'email', balanceSortField, balanceSortDirection, handleBalanceSort)}
                          {renderSortableHeader('Saldo Disponível', 'balance', balanceSortField, balanceSortDirection, handleBalanceSort, true)}
                        </>
                      )}
                      {reportType === 'sales_by_product' && (
                        <>
                          {renderSortableHeader('Descrição do Item', 'name', productSortField, productSortDirection, handleProductSort)}
                          {renderSortableHeader('Barraca / Ponto', 'stall', productSortField, productSortDirection, handleProductSort)}
                          {renderSortableHeader('Preço Unitário', 'price', productSortField, productSortDirection, handleProductSort, true)}
                          {renderSortableHeader('Qtd Vendida', 'quantity', productSortField, productSortDirection, handleProductSort, true)}
                          {renderSortableHeader('Total Acumulado', 'total', productSortField, productSortDirection, handleProductSort, true)}
                        </>
                      )}
                      {reportType === 'cards_report' && (
                        <>
                          {renderSortableHeader('Titular do Cartão', 'name', cardsSortField, cardsSortDirection, handleCardsSort)}
                          {renderSortableHeader('E-mail', 'email', cardsSortField, cardsSortDirection, handleCardsSort)}
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 border-none">QR Code / ID</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Origem</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Uso / Recargas</th>
                          {renderSortableHeader('Adesão / Cadastro', 'date', cardsSortField, cardsSortDirection, handleCardsSort, true)}
                          {renderSortableHeader('Saldo', 'balance', cardsSortField, cardsSortDirection, handleCardsSort, true)}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportType === 'financial_summary' && filteredFinancialSummary.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-black text-slate-700">{row.category}</td>
                        <td className="px-6 py-4 text-xs font-semibold text-slate-500 leading-normal">{row.desc}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                    
                    {reportType === 'sales_by_stall' && salesByStall.map((row, idx) => {
                      const isExpanded = expandedStall === row.stallName;
                      // Filter items sold at this specific stall
                      const stallItems = salesByProduct.filter(item => item.stall === row.stallName && item.quantity > 0);

                      return (
                        <React.Fragment key={idx}>
                          <tr 
                            onClick={() => setExpandedStall(isExpanded ? null : row.stallName)}
                            className="hover:bg-slate-50/50 cursor-pointer transition-colors border-b border-slate-100"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-black text-[10px] shrink-0">
                                  {row.stallName.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="leading-tight">
                                  <span className="font-bold text-slate-700 block">{row.stallName}</span>
                                  <span className="text-[10px] text-blue-600 font-extrabold hover:underline select-none">
                                    {isExpanded ? 'Ocultar faturamento detalhado ▲' : 'Ver faturamento detalhado ▼'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-slate-400 font-mono">{row.transactionCount} compras</td>
                            <td className="px-6 py-4 text-right font-black text-slate-900 font-mono">{formatCurrency(row.totalSales)}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/40 border-b border-slate-100">
                              <td colSpan={3} className="px-8 py-4">
                                <div className="bg-white/90 rounded-2xl border border-slate-200/60 p-5 space-y-3.5 shadow-inner">
                                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                                    <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                      Produtos Vendidos - {row.stallName}
                                    </h4>
                                    <span className="text-[10px] font-bold text-slate-500">
                                      Total do Período: {formatCurrency(row.totalSales)}
                                    </span>
                                  </div>
                                  {stallItems.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic">Nenhum item vendido registrado com detalhes neste período.</p>
                                  ) : (
                                    <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto pr-1">
                                      {stallItems.map((item, itemIdx) => {
                                        const percentageShare = row.totalSales > 0 ? Math.round((item.totalValue / row.totalSales) * 100) : 0;
                                        return (
                                          <div key={itemIdx} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                            <div className="flex items-center gap-2">
                                              <span className="h-1.5 w-1.5 rounded-full bg-slate-900 shrink-0 animate-pulse" />
                                              <span className="font-bold text-slate-700">{item.name}</span>
                                              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-black bg-slate-100 text-slate-600 font-mono">
                                                {percentageShare}%
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-4 justify-between font-mono shrink-0">
                                              <span className="text-[10px] font-bold text-slate-400 font-mono">
                                                {item.quantity} un. x {formatCurrency(item.price)}
                                              </span>
                                              <span className="font-black text-slate-900 w-24 text-right font-mono">
                                                {formatCurrency(item.totalValue)}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {reportType === 'transactions_log' && transactionsLog.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{row.date}</td>
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block text-sm">{row.user}</span>
                          {row.cardNumber && (
                            <span className="text-[10px] text-slate-400 font-mono block">Cartão: {row.cardNumber}</span>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-black uppercase tracking-widest ${row.type === 'CARGA' ? 'text-green-500' : 'text-blue-500'}`}>
                              {row.type}
                            </span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                              row.status === 'completed' ? 'bg-green-100 text-green-700' : 
                              row.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                              row.status === 'refunded' ? 'bg-slate-100 text-slate-600' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {row.status === 'completed' ? 'Sucesso' : row.status === 'refunded' ? 'Estornado' : row.status === 'pending' ? 'Pendente' : row.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-black text-slate-450 uppercase tracking-widest text-slate-500">{row.paymentMethod}</span>
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-500 text-xs">{row.stall}</td>
                        <td className={`px-6 py-4 text-right font-black ${row.type === 'CARGA' ? 'text-green-600' : 'text-slate-900'}`}>
                          {row.type === 'CARGA' ? '+' : '-'}{formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}

                    {reportType === 'user_balances' && userBalances.map((row, idx) => (
                      <tr 
                        key={idx} 
                        onClick={() => setSelectedDetail({
                          type: 'user',
                          id: row.uid || row.name,
                          title: row.name,
                          subtitle: row.email
                        })}
                        className="hover:bg-slate-50/70 active:bg-slate-100/80 cursor-pointer transition-colors"
                        title="Clique para ver detalhamento de movimentações deste titular"
                      >
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block text-sm">{row.name}</span>
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{row.role}</span>
                        </td>
                        <td className="px-6 py-4 text-xs font-semibold text-slate-500">{row.email}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatCurrency(row.balance)}</span>
                            <span className="text-[9px] uppercase font-black tracking-wider bg-slate-100 text-slate-405 px-1.5 py-0.5 rounded text-slate-400">Ver ➔</span>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {reportType === 'sales_by_product' && salesByProduct.map((row, idx) => (
                      <tr 
                        key={idx} 
                        onClick={() => setSelectedDetail({
                          type: 'product',
                          id: row.name,
                          title: row.name,
                          subtitle: row.stall
                        })}
                        className="hover:bg-slate-50/70 active:bg-slate-100/80 cursor-pointer transition-colors"
                        title="Clique para ver compradores e datas deste produto"
                      >
                        <td className="px-6 py-4 font-bold text-slate-700">{row.name}</td>
                        <td className="px-6 py-4 font-semibold text-slate-500 text-xs">{row.stall}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900 font-mono">{formatCurrency(row.price)}</td>
                        <td className="px-6 py-4 text-right font-bold text-slate-500 font-mono">{row.quantity || 0} un.</td>
                        <td className="px-6 py-4 text-right font-black text-emerald-600 font-mono">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatCurrency(row.totalValue || 0)}</span>
                            <span className="text-[9px] uppercase font-black tracking-wider bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">Ver ➔</span>
                          </div>
                        </td>
                      </tr>
                    ))}

                     {reportType === 'cards_report' && cardsReport.map((row, idx) => (
                      <tr 
                        key={row.uid || idx} 
                        onClick={() => setSelectedDetail({
                          type: 'card',
                          id: row.uid || row.qrCode,
                          title: row.name,
                          subtitle: row.email
                        })}
                        className="hover:bg-slate-50/70 active:bg-slate-100/80 cursor-pointer transition-colors select-none"
                        title="Clique para ver o histórico deste cartão"
                      >
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-800 block text-sm">{row.name}</span>
                          {row.isPhysical ? (
                            <span className="text-[8px] font-black uppercase tracking-widest text-blue-500">Impressão Física</span>
                          ) : (
                            <span className="text-[8px] font-black uppercase tracking-widest text-green-500">Autocadastro Cliente</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-semibold text-slate-500">{row.email}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-0.5 select-all">
                            <span className="font-mono text-[11px] font-black text-slate-700 leading-tight">{formatCardNumber(row.uid || row.qrCode)}</span>
                            <span className="font-mono text-[9px] text-slate-400">ID: {row.qrCode}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            row.isPhysical 
                              ? 'bg-blue-50 border border-blue-100 text-blue-700' 
                              : 'bg-emerald-50 border border-emerald-100 text-emerald-700'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${row.isPhysical ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                            {row.origin}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {row.hasRecharge ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
                                Utilizado ({row.rechargeCount}x)
                              </span>
                              <span className="text-[10px] text-slate-500 font-bold block">
                                Tot: {formatCurrency(row.totalRecharged)}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">
                              Apenas Ativado
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">{row.dateStr}</td>
                        <td className="px-6 py-4 text-right font-black text-emerald-600">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatCurrency(row.balance)}</span>
                            <span className="text-[9px] uppercase font-black tracking-wider bg-emerald-50 border border-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">Ver ➔</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {((reportType === 'financial_summary' && filteredFinancialSummary.length === 0) ||
                (reportType === 'sales_by_stall' && salesByStall.length === 0) ||
                (reportType === 'transactions_log' && transactionsLog.length === 0) ||
                (reportType === 'user_balances' && userBalances.length === 0) ||
                (reportType === 'sales_by_product' && salesByProduct.length === 0) ||
                (reportType === 'cards_report' && cardsReport.length === 0)) && (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-4 bg-slate-50/20">
                  <AlertCircle className="h-10 w-10 opacity-20 text-slate-500" />
                  <p className="font-bold text-xs uppercase tracking-widest opacity-60">Nenhum registro corresponde aos filtros definidos</p>
                </div>
              )}
            </CardContent>
          </Card>

          {reportType === 'financial_summary' && (
            <div className="mt-6">
              <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden bg-white p-6 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2 uppercase">
                      <CreditCard className="h-5 w-5 text-indigo-600" /> Análise de Recargas por Canal
                    </h3>
                    <p className="text-xs font-semibold text-slate-500">
                      Comparativo oficial entre cargas digitais (via PWA do Evento) e cargas físicas (efetuadas no Caixa).
                    </p>
                  </div>
                  <div className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-xs font-black text-slate-600 uppercase">
                    Total: {formatCurrency(rechargeChannelStats.granTotal)} ({rechargeChannelStats.granCount} txs)
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                  {/* Online Recargas Column */}
                  <div className="bg-emerald-50/15 border border-emerald-100/60 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100/60 text-emerald-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        RECARGAS ONLINE (PWA)
                      </span>
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Via Pix / Rede</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Valor Arrecadado</span>
                        <h4 className="text-2xl font-black text-slate-900">{formatCurrency(rechargeChannelStats.onlineTotal)}</h4>
                        <span className="text-[10px] text-emerald-600 font-bold block">{rechargeChannelStats.onlineValPct}% do faturamento de cargas</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quantidade (Qtd)</span>
                        <h4 className="text-2xl font-black text-slate-900">{rechargeChannelStats.onlineCount} <span className="text-xs text-slate-450 font-normal">recargas</span></h4>
                        <span className="text-[10px] text-emerald-600 font-bold block">{rechargeChannelStats.onlineCountPct}% do volume total de txs</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100/60 flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-505">Média por Recarga:</span>
                      <span className="font-black text-slate-800">{formatCurrency(rechargeChannelStats.onlineAvg)}</span>
                    </div>
                  </div>

                  {/* Cashier/Physical Recargas Column */}
                  <div className="bg-indigo-50/10 border border-indigo-100/50 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100/65 text-indigo-800">
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        RECARGAS NO CAIXA (FÍSICO)
                      </span>
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Via Caixa / PDV</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Valor Arrecadado</span>
                        <h4 className="text-2xl font-black text-slate-900">{formatCurrency(rechargeChannelStats.physicalTotal)}</h4>
                        <span className="text-[10px] text-indigo-600 font-bold block">{rechargeChannelStats.physicalValPct}% do faturamento de cargas</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quantidade (Qtd)</span>
                        <h4 className="text-2xl font-black text-slate-900">{rechargeChannelStats.physicalCount} <span className="text-xs text-slate-450 font-normal">recargas</span></h4>
                        <span className="text-[10px] text-indigo-600 font-bold block">{rechargeChannelStats.physicalCountPct}% do volume total de txs</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100/50 flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-505">Média por Recarga:</span>
                      <span className="font-black text-slate-800">{formatCurrency(rechargeChannelStats.physicalAvg)}</span>
                    </div>
                  </div>
                </div>

                {/* Progress bars showing graphic representation */}
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Distribuição Financeira (% do Valor de Entrada)</span>
                      <span className="font-bold text-slate-700">Online {rechargeChannelStats.onlineValPct}% vs Caixa {rechargeChannelStats.physicalValPct}%</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${rechargeChannelStats.onlineValPct}%` }} />
                      <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${rechargeChannelStats.physicalValPct}%` }} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Distribuição Operacional (% de Transações de Entrada)</span>
                      <span className="font-bold text-slate-700">Online {rechargeChannelStats.onlineCountPct}% vs Caixa {rechargeChannelStats.physicalCountPct}%</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${rechargeChannelStats.onlineCountPct}%` }} />
                      <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${rechargeChannelStats.physicalCountPct}%` }} />
                    </div>
                  </div>
                </div>

                {/* Detailed Payment Method Breakdown */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="flex flex-col gap-1">
                    <h4 className="text-xs font-black uppercase text-slate-500 tracking-[0.1em]">Detalhamento por Meio de Pagamento</h4>
                    <p className="text-[11px] font-semibold text-slate-400">Valores e quantidades exatos transacionados em cada modalidade.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Online Methods */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg w-max">
                        Online (Meios Digitais)
                      </div>
                      <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/20">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50/85 text-[10px] font-black text-slate-450 uppercase tracking-wider border-b border-slate-150">
                              <th className="px-4 py-2.5 font-bold">Meio</th>
                              <th className="px-4 py-2.5 font-bold text-right">Qtd</th>
                              <th className="px-4 py-2.5 font-bold text-right">Valor Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentMethodsStats
                              .filter(m => m.type === 'online')
                              .map(method => (
                                <tr key={method.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/55 transition-colors">
                                  <td className="px-4 py-3 flex items-center gap-2">
                                    <div className={`h-2.5 w-2.5 rounded-full ${method.color}`} />
                                    <span className="font-bold text-slate-700">{method.label}</span>
                                  </td>
                                  <td className="px-4 py-3 font-semibold text-slate-550 text-right tabular-nums">{method.count} recargas</td>
                                  <td className="px-4 py-3 font-black text-slate-800 text-right tabular-nums">{formatCurrency(method.amount)}</td>
                                </tr>
                              ))}
                            {paymentMethodsStats.filter(m => m.type === 'online').reduce((acc, x) => acc + x.count, 0) === 0 && (
                              <tr>
                                <td colSpan={3} className="px-4 py-6 text-center text-slate-450 text-[11px] font-bold uppercase">Nenhuma recarga online registrada</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Cashier/Physical Methods */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase tracking-wider text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-lg w-max">
                        Presencial (Caixa / PDV)
                      </div>
                      <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/20">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50/85 text-[10px] font-black text-slate-450 uppercase tracking-wider border-b border-slate-150">
                              <th className="px-4 py-2.5 font-bold">Meio</th>
                              <th className="px-4 py-2.5 font-bold text-right">Qtd</th>
                              <th className="px-4 py-2.5 font-bold text-right">Valor Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentMethodsStats
                              .filter(m => m.type === 'physical')
                              .map(method => (
                                <tr key={method.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/55 transition-colors">
                                  <td className="px-4 py-3 flex items-center gap-2">
                                    <div className={`h-2.5 w-2.5 rounded-full ${method.color}`} />
                                    <span className="font-bold text-slate-700">{method.label}</span>
                                  </td>
                                  <td className="px-4 py-3 font-semibold text-slate-550 text-right tabular-nums">{method.count} recargas</td>
                                  <td className="px-4 py-3 font-black text-slate-800 text-right tabular-nums">{formatCurrency(method.amount)}</td>
                                </tr>
                              ))}
                            {paymentMethodsStats.filter(m => m.type === 'physical').reduce((acc, x) => acc + x.count, 0) === 0 && (
                              <tr>
                                <td colSpan={3} className="px-4 py-6 text-center text-slate-450 text-[11px] font-bold uppercase">Nenhuma recarga presencial registrada</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Detail Modal for displaying contributing logs/records under the active filters */}
      {(() => {
        // Evaluate contributing logs matching active date filters
        const contributingRecords = selectedDetail ? (() => {
          if (selectedDetail.type === 'product') {
            return transactionsLog.filter(t => {
              if (t.type === 'COMPRA' && t.status === 'completed') {
                const hasItem = t.desc.toLowerCase().includes(selectedDetail.title.toLowerCase()) || 
                                (t.desc === '' && products.some(p => p.name === selectedDetail.title));
                const hasStall = t.stall.toLowerCase() === selectedDetail.subtitle.toLowerCase();
                return hasItem && hasStall;
              }
              return false;
            });
          }
          if (selectedDetail.type === 'user' || selectedDetail.type === 'card') {
            return transactionsLog.filter(t => {
              const cleanedId = selectedDetail.id.replace(/\s+/g, '');
              const cleanedCard = t.cardNumber ? t.cardNumber.replace(/\s+/g, '') : '';
              const userMatches = t.user.toLowerCase() === selectedDetail.title.toLowerCase() ||
                                  (cleanedCard && cleanedCard === formatCardNumber(selectedDetail.id).replace(/\s+/g, '')) ||
                                  (cleanedCard && cleanedCard === formatCardNumber(cleanedId).replace(/\s+/g, ''));
              return userMatches;
            });
          }
          return [];
        })() : [];

        if (!selectedDetail) return null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedDetail(null)} />
            
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl border border-slate-105 flex flex-col z-10 animate-in fade-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                <div>
                  <span className="text-[10px] font-black uppercase text-blue-600 tracking-widest block font-sans">
                    {selectedDetail.type === 'product' && 'Detalhamento de Vendas do Produto'}
                    {selectedDetail.type === 'user' && 'Histórico do Cliente / Titular'}
                    {selectedDetail.type === 'card' && 'Logs de Ativação / Recargas de Cartão'}
                  </span>
                  <h3 className="text-lg font-black text-slate-950 tracking-tight mt-0.5 font-sans">{selectedDetail.title}</h3>
                  <p className="text-xs text-slate-500 font-semibold font-sans">{selectedDetail.subtitle}</p>
                </div>
                <button 
                  onClick={() => setSelectedDetail(null)}
                  className="p-1 px-3 rounded-xl bg-white border border-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-50 text-xs font-black uppercase transition-all shadow-sm font-sans"
                >
                  Fechar ✕
                </button>
              </div>

              <div className="p-6 bg-slate-50 border-b border-slate-100">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500 font-sans">Filtro de Período Ativo:</p>
                <div className="grid grid-cols-2 gap-4 mt-2.5">
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-205 shadow-sm border-slate-200/60">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest block font-sans">Período de Análise</span>
                    <span className="text-xs font-bold text-slate-700 block mt-1 font-sans">
                      {startDate ? format(new Date(startDate + 'T00:00:00'), 'dd/MM/yyyy') : 'Todo o Histórico'} 
                      {endDate ? ` até ${format(new Date(endDate + 'T23:59:59'), 'dd/MM/yyyy')}` : ''}
                    </span>
                  </div>

                  <div className="bg-white p-3.5 rounded-2xl border border-slate-205 shadow-sm border-slate-200/60">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest block font-sans">Registros Capturados</span>
                    <span className="text-xs font-extrabold text-blue-600 block mt-1 font-sans">{contributingRecords.length} lançamentos</span>
                  </div>
                </div>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                {selectedDetail.type === 'product' && (
                  <div className="bg-emerald-50/50 border border-emerald-100/80 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                      <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider font-sans">Desempenho Geral</span>
                      <p className="text-xs text-emerald-800 font-medium leading-relaxed mt-0.5 font-sans">
                        Vendas ativas de <strong>{selectedDetail.title}</strong> na <strong>{selectedDetail.subtitle}</strong>.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 font-sans font-sans">Transações e Vendas Contribuintes</h4>
                  </div>

                  {contributingRecords.length === 0 ? (
                    <div className="py-12 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 text-xs">
                      <History className="h-8 w-8 opacity-20 mb-2.5" />
                      <p className="font-bold uppercase tracking-wider text-[10px] text-slate-400 font-sans">Nenhuma compra ou recarga registrada para este item/titular</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-sans">Com os filtros selecionados, não há atividade correspondente.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-100 shadow-sm bg-white">
                      {contributingRecords.slice(0, 45).map((log, logIdx) => (
                        <div key={logIdx} className="p-4 flex justify-between items-center gap-4 text-xs hover:bg-slate-50/50 transition-colors">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 truncate font-sans">{log.user}</span>
                              <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                                log.type === 'CARGA' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {log.type}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-bold leading-normal font-sans">
                              <span>{log.date}</span>
                              {log.stall && (
                                <>
                                  <span>•</span>
                                  <span>{log.stall}</span>
                                </>
                              )}
                              <span>•</span>
                              <span className="font-mono text-[9px] uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[120px]">{log.paymentMethod}</span>
                            </div>
                            {log.desc && (
                              <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-1 font-sans">{log.desc}</p>
                            )}
                          </div>
                          <div className={`font-black font-mono shrink-0 text-right ${log.type === 'CARGA' ? 'text-green-600' : 'text-slate-900'}`}>
                            {log.type === 'CARGA' ? '+' : '-'}{formatCurrency(log.amount)}
                          </div>
                        </div>
                      ))}
                      {contributingRecords.length > 45 && (
                        <p className="p-3 text-center text-[10px] font-bold text-slate-400 bg-slate-50/50 font-sans">E mais {contributingRecords.length - 45} transações correspondentes...</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
