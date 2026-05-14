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
  AlertCircle
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
  const [reportType, setReportType] = useState<'sales_by_stall' | 'sales_by_product' | 'financial_summary' | 'user_balances' | 'transactions_log'>('financial_summary');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');

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

  // 1. Financial Summary Data
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
      
      return isStatusMatch && isDateMatch;
    });
  }, [transactions, startDate, endDate, statusFilter]);

  const financialSummary = useMemo(() => {
    const totalCredits = filteredTransactions
      .filter(t => t.type === 'credit' && t.status === 'completed')
      .reduce((acc, t) => acc + (t.amount || 0), 0);
    
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
      { category: 'Total de Cargas', amount: totalCredits, desc: 'Dinheiro que entrou no sistema' },
      { category: 'Total de Consumo', amount: totalDebits, desc: 'Vendas realizadas nas barracas' },
      { category: 'Total de Saques', amount: totalWithdrawals, desc: 'Saques realizados por vendedores' },
      { category: 'Saldo em Circulação', amount: totalCredits - totalDebits, desc: 'Saldo pendente nos cartões' },
    ];
  }, [filteredTransactions, withdrawals, startDate, endDate]);

  // 2. Sales by Stall Data
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
    }).sort((a, b) => b.totalSales - a.totalSales);
  }, [stalls, filteredTransactions]);

  // 3. Transactions Log
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
        // Tentar extrair o nome da barraca da descrição se stallName estiver faltando
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
          desc: t.description || ''
        };
      });
  }, [filteredTransactions, users]);

  // 4. Sales by Product Data
  const salesByProduct = useMemo(() => {
    return products.map(p => {
      const stall = stalls.find(s => s.id === p.vendorId);
      return {
        name: p.name || 'Produto sem nome',
        price: p.price || 0,
        stall: stall?.name || 'Barraca N/A',
      };
    }).sort((a, b) => a.stall.localeCompare(b.stall));
  }, [products, stalls]);

  // 5. User Balances
  const userBalances = useMemo(() => {
    return users
      .filter(u => u.role === 'student' || u.role === 'admin')
      .map(u => ({
        name: u.name || 'Sem nome',
        email: u.email || 'N/A',
        balance: u.balance || 0,
        role: u.role === 'student' ? 'Cliente' : 'Admin'
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [users]);

  const exportToExcel = () => {
    try {
      let data: any[] = [];
      let filename = 'relatorio';

      if (reportType === 'financial_summary') {
        data = financialSummary.map(row => ({ 'Categoria': row.category, 'Valor (R$)': row.amount.toFixed(2), 'Descrição': row.desc }));
        filename = 'resumo_financeiro';
      } else if (reportType === 'sales_by_stall') {
        data = salesByStall.map(row => ({ 'Barraca': row.stallName, 'Total Vendas (R$)': row.totalSales.toFixed(2), 'Qtd Transações': row.transactionCount }));
        filename = 'vendas_por_barraca';
      } else if (reportType === 'user_balances') {
        data = userBalances.map(row => ({ 'Nome': row.name, 'Email': row.email, 'Saldo Atual (R$)': row.balance.toFixed(2), 'Tipo': row.role }));
        filename = 'saldos_clientes';
      } else if (reportType === 'sales_by_product') {
        data = salesByProduct.map(row => ({ 'Produto': row.name, 'Preço Unitário (R$)': row.price.toFixed(2), 'Barraca': row.stall }));
        filename = 'catalogo_produtos';
      } else if (reportType === 'transactions_log') {
        data = transactionsLog.map(row => ({ 'Data': row.date, 'Usuário': row.user, 'Tipo': row.type, 'Valor (R$)': row.amount.toFixed(2), 'Barraca/Ponto': row.stall, 'Descrição': row.desc }));
        filename = 'log_transacoes';
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
      doc.text('REDE ALPHA - GESTÃO DE EVENTOS', 14, 20);
      doc.setFontSize(14);
      doc.text(title, 14, 30);
      doc.setFontSize(10);
      doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 38);

      let head: string[][] = [];
      let body: any[][] = [];

      if (reportType === 'financial_summary') {
        head = [['Categoria', 'Valor (R$)', 'Descrição']];
        body = financialSummary.map(row => [row.category, formatCurrency(row.amount), row.desc]);
      } else if (reportType === 'sales_by_stall') {
        head = [['Barraca', 'Total Vendas (R$)', 'Qtd Transações']];
        body = salesByStall.map(row => [row.stallName, formatCurrency(row.totalSales), row.transactionCount]);
      } else if (reportType === 'user_balances') {
        head = [['Nome', 'Email', 'Saldo Atual (R$)', 'Tipo']];
        body = userBalances.map(row => [row.name, row.email, formatCurrency(row.balance), row.role]);
      } else if (reportType === 'sales_by_product') {
        head = [['Produto', 'Preço Unitário (R$)', 'Barraca']];
        body = salesByProduct.map(row => [row.name, formatCurrency(row.price), row.stall]);
      } else if (reportType === 'transactions_log') {
        head = [['Data', 'Usuário', 'Tipo', 'Valor', 'Barraca']];
        body = transactionsLog.map(row => [row.date, row.user, row.type, formatCurrency(row.amount), row.stall]);
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
            Acompanhamento em tempo real da saúde financeira do seu evento.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Início</label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Fim</label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest px-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-950/10 min-w-[120px]"
            >
              <option value="all">Todos</option>
              <option value="completed">Concluídos</option>
              <option value="pending">Pendentes</option>
              <option value="failed">Falhos</option>
            </select>
          </div>
          {(startDate || endDate || statusFilter !== 'all') && (
            <Button 
              variant="ghost" 
              onClick={() => { setStartDate(''); setEndDate(''); setStatusFilter('all'); }}
              className="h-9 mt-4 text-[10px] font-black uppercase text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              Limpar
            </Button>
          )}
        </div>

        <div className="flex gap-3">
          <Button 
            onClick={exportToPDF}
            variant="outline"
            className="rounded-xl border-slate-200 font-bold text-xs uppercase tracking-wider h-12 px-6"
          >
            <Download className="h-4 w-4 mr-2" /> PDF
          </Button>
          <Button 
            onClick={exportToExcel}
            className="rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-xs uppercase tracking-wider h-12 px-6 shadow-md"
          >
            <TableIcon className="h-4 w-4 mr-2" /> Excel
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4 px-2">Categorias</p>
            <nav className="space-y-1.5">
              {[
                { id: 'financial_summary', label: 'Resumo Financeiro', icon: DollarSign },
                { id: 'sales_by_stall', label: 'Vendas/Barraca', icon: Store },
                { id: 'transactions_log', label: 'Histórico de Vendas', icon: History },
                { id: 'user_balances', label: 'Saldos Atuais', icon: Users },
                { id: 'sales_by_product', label: 'Catálogo/Preços', icon: Package },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => setReportType(type.id as any)}
                  className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl transition-all border ${
                    reportType === type.id 
                      ? 'bg-slate-950 text-white border-slate-950 shadow-lg translate-x-1' 
                      : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <type.icon className={`h-4.5 w-4.5 ${reportType === type.id ? 'text-white' : 'text-slate-400'}`} />
                  <span className="font-bold text-sm">{type.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100 space-y-3">
            <div className="flex items-center gap-2 text-blue-700">
               <TrendingUp className="h-4 w-4" />
               <span className="text-xs font-black uppercase tracking-wider">Dica do Sistema</span>
            </div>
            <p className="text-xs text-blue-600 leading-relaxed font-medium">
              Utilize o <strong>Log Completo</strong> para auditar transações individuais em caso de divergências.
            </p>
          </div>
        </div>

        <div className="lg:col-span-3">
          <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden bg-white">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {reportType === 'financial_summary' && 'Resumo Financeiro Consolidado'}
                    {reportType === 'sales_by_stall' && 'Desempenho por Ponto de Venda'}
                    {reportType === 'transactions_log' && 'Histórico de Vendas Detalhado'}
                    {reportType === 'user_balances' && 'Relatório de Créditos Ativos'}
                    {reportType === 'sales_by_product' && 'Catálogo e Precificação'}
                  </CardTitle>
                  <CardDescription className="font-medium mt-1">
                    Visualização detalhada dos dados do evento.
                  </CardDescription>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Última Atualização</span>
                  <span className="text-xs font-bold text-slate-600">{format(new Date(), 'HH:mm:ss')}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto min-w-full">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/80">
                      {reportType === 'financial_summary' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Indicador</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Descrição</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Valor</th>
                        </>
                      )}
                      {reportType === 'sales_by_stall' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Barraca</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Vendas</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Total Acumulado</th>
                        </>
                      )}
                      {reportType === 'transactions_log' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Horário</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Usuário</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Barraca</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Valor</th>
                        </>
                      )}
                      {reportType === 'user_balances' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Nome do Cliente</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Email</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Saldo Disponível</th>
                        </>
                      )}
                      {reportType === 'sales_by_product' && (
                        <>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Item</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400">Setor/Barraca</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-black tracking-wider text-slate-400 text-right">Preço Unitário</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportType === 'financial_summary' && financialSummary.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-black text-slate-700">{row.category}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-500">{row.desc}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                    {reportType === 'sales_by_stall' && salesByStall.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-black text-[10px]">
                              {row.stallName.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-bold text-slate-700">{row.stallName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-slate-400">{row.transactionCount} txs</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.totalSales)}</td>
                      </tr>
                    ))}
                    {reportType === 'transactions_log' && transactionsLog.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-bold text-slate-400">{row.date}</td>
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block text-sm">{row.user}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-black uppercase tracking-tighter ${row.type === 'CARGA' ? 'text-green-500' : 'text-blue-500'}`}>
                              {row.type}
                            </span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                              row.status === 'completed' ? 'bg-green-100 text-green-700' : 
                              row.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                              'bg-red-100 text-red-700'
                            }`}>
                              {row.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-500 text-sm">{row.stall}</td>
                        <td className={`px-6 py-4 text-right font-black ${row.type === 'CARGA' ? 'text-green-600' : 'text-slate-900'}`}>
                          {row.type === 'CARGA' ? '+' : '-'}{formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                    {reportType === 'user_balances' && userBalances.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block">{row.name}</span>
                          <span className="text-[10px] font-black uppercase text-slate-300 tracking-widest">{row.role}</span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{row.email}</td>
                        <td className="px-6 py-4 text-right font-black text-green-600">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))}
                    {reportType === 'sales_by_product' && salesByProduct.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-700">{row.name}</td>
                        <td className="px-6 py-4 font-medium text-slate-500">{row.stall}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">{formatCurrency(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {((reportType === 'financial_summary' && financialSummary.length === 0) ||
                (reportType === 'sales_by_stall' && salesByStall.length === 0) ||
                (reportType === 'transactions_log' && transactionsLog.length === 0) ||
                (reportType === 'user_balances' && userBalances.length === 0) ||
                (reportType === 'sales_by_product' && salesByProduct.length === 0)) && (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-4">
                  <AlertCircle className="h-10 w-10 opacity-20" />
                  <p className="font-bold text-sm uppercase tracking-widest opacity-50">Nenhum dado encontrado para este relatório</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
