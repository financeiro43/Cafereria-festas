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
  ArrowDownLeft
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
}

export default function ReportsPortal({ 
  stalls = [], 
  products = [], 
  users = [], 
  transactions = [], 
  withdrawals = [] 
}: ReportsPortalProps) {
  const [reportType, setReportType] = useState<'sales_by_stall' | 'sales_by_product' | 'financial_summary' | 'user_balances' | 'transactions_log' | 'cards_report'>('financial_summary');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cardOriginFilter, setCardOriginFilter] = useState<'all' | 'system' | 'client'>('all');

  // Helper to format currency
  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Helper to format date safety
  const formatDate = (timestamp: any) => {
    try {
      if (!timestamp) return 'N/A';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      if (isNaN(date.getTime())) return 'Data Inválida';
      return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
    } catch (e) {
      return 'Erro na Data';
    }
  };

  // 1. Transactions filtered by state criteria
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const date = t.timestamp?.toDate ? t.timestamp.toDate() : new Date(t.timestamp);
      
      const isStatusMatch = statusFilter === 'all' || t.status === statusFilter;
      
      let isDateMatch = true;
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        isDateMatch = isDateMatch && date >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        isDateMatch = isDateMatch && date <= end;
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
        const date = w.timestamp?.toDate ? w.timestamp.toDate() : new Date(w.timestamp);
        let isDateMatch = true;
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          isDateMatch = isDateMatch && date >= start;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          isDateMatch = isDateMatch && date <= end;
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

  // 3. Sales by Stall Data
  const salesByStall = useMemo(() => {
    return stalls.map(stall => {
      const stallSales = filteredTransactions
        .filter(t => t.type === 'debit' && t.status === 'completed' && t.vendorId === stall.id);
      
      const totalAmount = stallSales.reduce((acc, t) => acc + (t.amount || 0), 0);
      const totalCount = stallSales.length;

      return {
        stallName: stall.name || 'Sem nome',
        totalSales: totalAmount,
        transactionCount: totalCount,
      };
    })
    .filter(row => {
      if (!searchQuery.trim()) return true;
      const queryNorm = searchQuery.toLowerCase().trim();
      return row.stallName.toLowerCase().includes(queryNorm);
    })
    .sort((a, b) => b.totalSales - a.totalSales);
  }, [stalls, filteredTransactions, searchQuery]);

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
          user: user?.name || 'Sistema',
          type: t.type === 'credit' ? 'CARGA' : 'COMPRA',
          status: t.status || 'completed',
          amount: t.amount || 0,
          stall: stall,
          paymentMethod: t.paymentMethod || 'N/A',
          desc: t.description || ''
        };
      });
  }, [filteredTransactions, users]);

  // 5. Sales by Product Data
  const salesByProduct = useMemo(() => {
    return products.map(p => {
      const stall = stalls.find(s => s.id === p.vendorId);
      return {
        name: p.name || 'Produto sem nome',
        price: p.price || 0,
        stall: stall?.name || 'Barraca N/A',
      };
    })
    .filter(row => {
      if (!searchQuery.trim()) return true;
      const queryNorm = searchQuery.toLowerCase().trim();
      return row.name.toLowerCase().includes(queryNorm) || row.stall.toLowerCase().includes(queryNorm);
    })
    .sort((a, b) => a.stall.localeCompare(b.stall));
  }, [products, stalls, searchQuery]);

  // 6. User Balances
  const userBalances = useMemo(() => {
    return users
      .filter(u => u.role === 'student' || u.role === 'admin')
      .map(u => ({
        name: u.name || 'Sem nome',
        email: u.email || 'N/A',
        balance: u.balance || 0,
        role: u.role === 'student' ? 'Cliente' : 'Admin'
      }))
      .filter(row => {
        if (!searchQuery.trim()) return true;
        const queryNorm = searchQuery.toLowerCase().trim();
        return row.name.toLowerCase().includes(queryNorm) || row.email.toLowerCase().includes(queryNorm);
      })
      .sort((a, b) => b.balance - a.balance);
  }, [users, searchQuery]);

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

        return {
          uid: u.uid,
          name: u.name || 'Sem nome',
          email: u.email || 'N/A',
          qrCode: u.qrCode || u.uid,
          balance: u.balance || 0,
          isPhysical: !!u.isPhysicalCard,
          origin: u.isPhysicalCard ? 'Sistema (Físico)' : 'Online (Cliente)',
          dateStr: creationDate,
          timestampMillis: timestampMillis
        };
      })
      .filter(row => {
        // Source/Origin filter
        if (cardOriginFilter === 'system' && !row.isPhysical) return false;
        if (cardOriginFilter === 'client' && row.isPhysical) return false;

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
      .sort((a, b) => b.timestampMillis - a.timestampMillis); // newest first
  }, [users, cardOriginFilter, searchQuery]);

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
        const distinctStalls = new Set(salesByProduct.map(p => p.stall)).size;
        const prSum = salesByProduct.reduce((acc, p) => acc + p.price, 0);
        const avgPrice = totalProdCount > 0 ? prSum / totalProdCount : 0;
        const highestPrice = totalProdCount > 0 ? Math.max(...salesByProduct.map(p => p.price)) : 0;

        return [
          { label: 'Itens no Catálogo', value: `${totalProdCount} produtos`, text: 'Cadastrados no cardápio', type: 'success' },
          { label: 'Barracas Participantes', value: `${distinctStalls} pontos`, text: 'Pontos com catálogo ativo', type: 'info' },
          { label: 'Preço Médio Unitário', value: formatCurrency(avgPrice), text: 'Média de precificação', type: 'warning' },
          { label: 'Preço Máximo Praticado', value: formatCurrency(highestPrice), text: 'Item mais valioso do menu', type: 'danger' },
        ];
      }
      case 'cards_report': {
        const totalCards = cardsReport.length;
        const pCards = cardsReport.filter(c => c.isPhysical).length;
        const vCards = cardsReport.filter(c => !c.isPhysical).length;
        const totalBal = cardsReport.reduce((acc, c) => acc + c.balance, 0);
        const clientPct = totalCards > 0 ? Math.round((vCards / totalCards) * 100) : 0;

        return [
          { label: 'Total de Cartões', value: `${totalCards} ativos`, text: 'Soma de físico mais online', type: 'success' },
          { label: 'Gerados p/ Sistema (Físicos)', value: `${pCards} cartões`, text: 'Impressos ou via ADM', type: 'info' },
          { label: 'Gerados p/ Cliente (Online)', value: `${vCards} cadastros`, text: `Percentual de adesão: ${clientPct}%`, type: 'warning' },
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
        data = filteredFinancialSummary.map(row => ({ 'Categoria': row.category, 'Valor (R$)': row.amount.toFixed(2), 'Descrição': row.desc }));
        filename = 'resumo_financeiro';
      } else if (reportType === 'sales_by_stall') {
        data = salesByStall.map(row => ({ 'Barraca': row.stallName, 'Total Vendas (R$)': row.totalSales.toFixed(2), 'Qtd Transações': row.transactionCount }));
        filename = 'vendas_por_barraca';
      } else if (reportType === 'user_balances') {
        data = userBalances.map(row => ({ 'Nome': row.name, 'Email': row.email, 'Saldo Atual (R$)': row.balance.toFixed(2) }));
        filename = 'saldos_clientes';
      } else if (reportType === 'sales_by_product') {
        data = salesByProduct.map(row => ({ 'Produto': row.name, 'Preço Unitário (R$)': row.price.toFixed(2), 'Barraca': row.stall }));
        filename = 'catalogo_produtos';
      } else if (reportType === 'transactions_log') {
        data = transactionsLog.map(row => ({ 'Data': row.date, 'Usuário': row.user, 'Tipo': row.type, 'Meio': row.paymentMethod, 'Valor (R$)': row.amount.toFixed(2), 'Barraca/Ponto': row.stall, 'Descrição': row.desc }));
        filename = 'log_transacoes';
      } else if (reportType === 'cards_report') {
        data = cardsReport.map(row => ({ 'Nome': row.name, 'Email': row.email, 'QR Code': row.qrCode, 'Origem': row.origin, 'Saldo (R$)': row.balance.toFixed(2), 'Data de Cadastro': row.dateStr }));
        filename = 'registro_de_cartoes';
      }

      const ws = XLSX.utils.json_to_sheet(data);
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
        head = [['Barraca', 'Total Vendas (R$)', 'Qtd Transações']];
        body = salesByStall.map(row => [row.stallName, formatCurrency(row.totalSales), row.transactionCount]);
      } else if (reportType === 'user_balances') {
        head = [['Nome', 'Email', 'Saldo Atual (R$)']];
        body = userBalances.map(row => [row.name, row.email, formatCurrency(row.balance)]);
      } else if (reportType === 'sales_by_product') {
        head = [['Produto', 'Preço Unitário (R$)', 'Barraca']];
        body = salesByProduct.map(row => [row.name, formatCurrency(row.price), row.stall]);
      } else if (reportType === 'transactions_log') {
        head = [['Data', 'Usuário', 'Tipo', 'Meio', 'Valor', 'Barraca']];
        body = transactionsLog.map(row => [row.date, row.user, row.type, row.paymentMethod, formatCurrency(row.amount), row.stall]);
      } else if (reportType === 'cards_report') {
        head = [['Nome', 'Email', 'QR Code', 'Origem', 'Saldo (R$)', 'Cadastro']];
        body = cardsReport.map(row => [row.name, row.email, row.qrCode, row.origin, formatCurrency(row.balance), row.dateStr]);
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

          {/* Clear button */}
          {(startDate || endDate || statusFilter !== 'all' || cardOriginFilter !== 'all' || searchQuery) && (
            <Button 
              variant="ghost" 
              onClick={() => { 
                setStartDate(''); 
                setEndDate(''); 
                setStatusFilter('all'); 
                setCardOriginFilter('all');
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
                { id: 'sales_by_product', label: 'Catálogo/Preços', icon: Package },
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
                    {reportType === 'sales_by_product' && 'Catálogo e Precificação'}
                    {reportType === 'cards_report' && 'Ativação de Cartões (Físico vs Online)'}
                  </CardTitle>
                  <CardDescription className="font-semibold mt-1">
                    Visualização de dados refinada com filtros dinâmicos de texto e período.
                  </CardDescription>
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
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Barraca / PDV</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Volume</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Total Acumulado</th>
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
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Nome do Titular</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">E-mail</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Saldo Disponível</th>
                        </>
                      )}
                      {reportType === 'sales_by_product' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Descrição do Item</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Barraca / Ponto</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Preço Unitário</th>
                        </>
                      )}
                      {reportType === 'cards_report' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Titular do Cartão</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">E-mail</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 border-none">QR Code / ID</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Origem</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Adesão / Cadastro</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Saldo</th>
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
                    
                    {reportType === 'sales_by_stall' && salesByStall.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-black text-[10px] shrink-0">
                              {row.stallName.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-bold text-slate-700">{row.stallName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-slate-400">{row.transactionCount} compras</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.totalSales)}</td>
                      </tr>
                    ))}

                    {reportType === 'transactions_log' && transactionsLog.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{row.date}</td>
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block text-sm">{row.user}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-black uppercase tracking-widest ${row.type === 'CARGA' ? 'text-green-500' : 'text-blue-500'}`}>
                              {row.type}
                            </span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                              row.status === 'completed' ? 'bg-green-100 text-green-700' : 
                              row.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                              'bg-red-100 text-red-700'
                            }`}>
                              {row.status === 'completed' ? 'Sucesso' : row.status}
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
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block">{row.name}</span>
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{row.role}</span>
                        </td>
                        <td className="px-6 py-4 text-xs font-semibold text-slate-500">{row.email}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))}

                    {reportType === 'sales_by_product' && salesByProduct.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-700">{row.name}</td>
                        <td className="px-6 py-4 font-semibold text-slate-500 text-xs">{row.stall}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.price)}</td>
                      </tr>
                    ))}

                    {reportType === 'cards_report' && cardsReport.map((row, idx) => (
                      <tr key={row.uid || idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-800 block text-sm">{row.name}</span>
                          {row.isPhysical ? (
                            <span className="text-[8px] font-black uppercase tracking-widest text-blue-500">Impressão Física</span>
                          ) : (
                            <span className="text-[8px] font-black uppercase tracking-widest text-green-500">Autocadastro Cliente</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-semibold text-slate-500">{row.email}</td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-400 select-all">{row.qrCode}</td>
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
                        <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">{row.dateStr}</td>
                        <td className="px-6 py-4 text-right font-black text-emerald-600">
                          {formatCurrency(row.balance)}
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
    </div>
  );
}
