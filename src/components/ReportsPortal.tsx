import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Stall, Product, UserProfile, Transaction, Withdrawal } from '../types';
import { FileText, Download, BarChart3, Filter, Table as TableIcon, Calendar, TrendingUp, DollarSign, Users, Store, Package } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface ReportsPortalProps {
  stalls: Stall[];
  products: Product[];
  users: UserProfile[];
  transactions: Transaction[];
  withdrawals: Withdrawal[];
}

export default function ReportsPortal({ stalls, products, users, transactions, withdrawals }: ReportsPortalProps) {
  const [reportType, setReportType] = useState<'sales_by_stall' | 'sales_by_product' | 'financial_summary' | 'user_balances' | 'transactions_log'>('financial_summary');

  // Helper to format currency
  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Helper to format date
  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  };

  // 1. Financial Summary Data
  const getFinancialSummary = () => {
    const totalCredits = transactions
      .filter(t => t.type === 'credit' && t.status === 'completed')
      .reduce((acc, t) => acc + t.amount, 0);
    
    const totalDebits = transactions
      .filter(t => t.type === 'debit' && t.status === 'completed')
      .reduce((acc, t) => acc + t.amount, 0);
    
    const totalWithdrawals = withdrawals
      .reduce((acc, w) => acc + w.amount, 0);

    return [
      { category: 'Cargas Realizadas (R$)', amount: totalCredits },
      { category: 'Consumo Total (R$)', amount: totalDebits },
      { category: 'Saques Realizados (R$)', amount: totalWithdrawals },
      { category: 'Saldo em Circulação (R$)', amount: totalCredits - totalDebits },
    ];
  };

  // 2. Sales by Stall Data
  const getSalesByStall = () => {
    return stalls.map(stall => {
      const stallSales = transactions
        .filter(t => t.type === 'debit' && t.status === 'completed' && t.vendorId === stall.id);
      
      const totalAmount = stallSales.reduce((acc, t) => acc + t.amount, 0);
      const totalCount = stallSales.length;

      return {
        stallName: stall.name,
        totalSales: totalAmount,
        transactionCount: totalCount,
      };
    }).sort((a, b) => b.totalSales - a.totalSales);
  };

  // 3. Transactions Log
  const getTransactionsLog = () => {
    return [...transactions]
      .sort((a, b) => {
        const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
        const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
        return dateB.getTime() - dateA.getTime();
      })
      .map(t => {
        const user = users.find(u => u.uid === t.userId);
        return {
          date: formatDate(t.timestamp),
          user: user?.name || 'Sistema',
          type: t.type === 'credit' ? 'CARGA' : 'COMPRA',
          amount: t.amount,
          stall: t.stallName || 'N/A',
          desc: t.description || ''
        };
      });
  };

  // 4. Sales by Product Data
  const getSalesByProduct = () => {
    return products.map(p => {
      const stall = stalls.find(s => s.id === p.vendorId);
      return {
        name: p.name,
        price: p.price,
        stall: stall?.name || 'N/A',
      };
    }).sort((a, b) => a.stall.localeCompare(b.stall));
  };

  // 5. User Balances
  const getUserBalances = () => {
    return users
      .filter(u => u.role === 'student' || u.role === 'admin')
      .map(u => ({
        name: u.name,
        email: u.email,
        balance: u.balance || 0,
        role: u.role === 'student' ? 'Cliente' : 'Admin'
      }))
      .sort((a, b) => b.balance - a.balance);
  };

  const exportToExcel = () => {
    let data: any[] = [];
    let fileName = 'relatorio';

    if (reportType === 'financial_summary') {
      data = getFinancialSummary().map(row => ({ 'Categoria': row.category, 'Valor (R$)': row.amount.toFixed(2) }));
      fileName = 'resumo_financeiro';
    } else if (reportType === 'sales_by_stall') {
      data = getSalesByStall().map(row => ({ 'Barraca': row.stallName, 'Total Vendas (R$)': row.totalSales.toFixed(2), 'Qtd Transações': row.transactionCount }));
      fileName = 'vendas_por_barraca';
    } else if (reportType === 'user_balances') {
      data = getUserBalances().map(row => ({ 'Nome': row.name, 'Email': row.email, 'Saldo Atual (R$)': row.balance.toFixed(2), 'Tipo': row.role }));
      fileName = 'saldos_clientes';
    } else if (reportType === 'sales_by_product') {
      data = getSalesByProduct().map(row => ({ 'Produto': row.name, 'Preço Unitário (R$)': row.price.toFixed(2), 'Barraca': row.stall }));
      fileName = 'catalogo_produtos';
    } else if (reportType === 'transactions_log') {
      data = getTransactionsLog().map(row => ({ 'Data': row.date, 'Usuário': row.user, 'Tipo': row.type, 'Valor (R$)': row.amount.toFixed(2), 'Barraca/Ponto': row.stall, 'Descrição': row.desc }));
      fileName = 'log_transacoes';
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `${fileName}_${new Date().getTime()}.xlsx`);
    toast.success('Excel exportado com sucesso!');
  };

  const exportToPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF() as any;
    const title = reportType.replace(/_/g, ' ').toUpperCase();
    
    doc.setFontSize(20);
    doc.text('MODELO ALPHA - RELATÓRIO DO EVENTO', 14, 22);
    doc.setFontSize(14);
    doc.text(title, 14, 32);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 40);

    let head: string[][] = [];
    let body: any[][] = [];

    if (reportType === 'financial_summary') {
      head = [['Categoria', 'Valor (R$)']];
      body = getFinancialSummary().map(row => [row.category, formatCurrency(row.amount)]);
    } else if (reportType === 'sales_by_stall') {
      head = [['Barraca', 'Total Vendas (R$)', 'Qtd Transações']];
      body = getSalesByStall().map(row => [row.stallName, formatCurrency(row.totalSales), row.transactionCount]);
    } else if (reportType === 'user_balances') {
      head = [['Nome', 'Email', 'Saldo Atual (R$)', 'Tipo']];
      body = getUserBalances().map(row => [row.name, row.email, formatCurrency(row.balance), row.role]);
    } else if (reportType === 'sales_by_product') {
      head = [['Produto', 'Preço Unitário (R$)', 'Barraca']];
      body = getSalesByProduct().map(row => [row.name, formatCurrency(row.price), row.stall]);
    } else if (reportType === 'transactions_log') {
      head = [['Data', 'Usuário', 'Tipo', 'Valor', 'Barraca']];
      body = getTransactionsLog().map(row => [row.date, row.user, row.type, formatCurrency(row.amount), row.stall]);
    }

    autoTable(doc, {
      head: head,
      body: body,
      startY: 45,
      theme: 'grid',
      headStyles: { fillStyle: [15, 23, 42], textColor: [255, 255, 255] } as any,
    });

    doc.save(`${reportType}_${new Date().getTime()}.pdf`);
    toast.success('PDF exportado com sucesso!');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-slate-100">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600">
            <BarChart3 className="h-3 w-3" />
            <span className="text-[10px] font-black uppercase tracking-widest">Inteligência de Dados</span>
          </div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-slate-950 flex items-center justify-center text-white shadow-2xl rotate-3 shrink-0">
              <FileText className="h-7 w-7" />
            </div>
            RELATÓRIOS DO EVENTO
          </h2>
          <p className="text-slate-500 text-lg font-medium max-w-xl leading-relaxed">
            Visualize o desempenho financeiro, vendas por barraca e saldos de clientes em tempo real.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <Button 
            onClick={exportToPDF}
            variant="outline"
            className="h-14 px-6 rounded-2xl border-slate-200 hover:bg-slate-50 font-bold text-xs uppercase tracking-widest flex items-center gap-2"
          >
            <Download className="h-4 w-4" /> Exportar PDF
          </Button>
          <Button 
            onClick={exportToExcel}
            className="h-14 px-6 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-xl"
          >
            <TableIcon className="h-4 w-4" /> Exportar Excel
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="space-y-4">
           <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Tipos de Relatório</p>
           <nav className="flex flex-col gap-2">
             {[
               { id: 'financial_summary', label: 'Resumo Financeiro', icon: DollarSign },
               { id: 'sales_by_stall', label: 'Vendas por Barraca', icon: Store },
               { id: 'transactions_log', label: 'Log de Transações', icon: History },
               { id: 'user_balances', label: 'Saldo de Clientes', icon: Users },
               { id: 'sales_by_product', label: 'Catálogo de Produtos', icon: Package },
             ].map((type) => (
               <button
                 key={type.id}
                 onClick={() => setReportType(type.id as any)}
                 className={`flex items-center gap-4 p-4 rounded-2xl transition-all border ${
                   reportType === type.id 
                     ? 'bg-slate-950 text-white border-slate-950 shadow-xl' 
                     : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50'
                 }`}
               >
                 <type.icon className="h-5 w-5" />
                 <span className="font-bold text-sm">{type.label}</span>
               </button>
             ))}
           </nav>
        </div>

        <div className="lg:col-span-3">
           <Card className="rounded-[32px] border-slate-200 shadow-sm overflow-hidden">
             <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-8">
               <CardTitle className="uppercase font-black tracking-tight flex items-center gap-2">
                 <FileText className="h-5 w-5 text-blue-600" />
                 {reportType === 'financial_summary' ? 'Resumo Financeiro Consolidado' :
                  reportType === 'sales_by_stall' ? 'Desempenho por Ponto de Venda' :
                  reportType === 'transactions_log' ? 'Histórico Completo de Movimentações' :
                  reportType === 'user_balances' ? 'Relatório de Saldos em Aberto' : 'Visão Geral do Catálogo'}
               </CardTitle>
               <CardDescription>Dados atualizados em {format(new Date(), 'HH:mm:ss')}</CardDescription>
             </CardHeader>
             <CardContent className="p-0">
               <div className="overflow-x-auto min-w-full">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="bg-slate-50/50">
                        {reportType === 'financial_summary' && (
                          <>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Categoria</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Valor</th>
                          </>
                        )}
                        {reportType === 'sales_by_stall' && (
                          <>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Barraca</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Qtd Transações</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Total Vendido</th>
                          </>
                        )}
                        {reportType === 'transactions_log' && (
                          <>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Data</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Usuário</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Tipo</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Valor</th>
                          </>
                        )}
                        {reportType === 'user_balances' && (
                          <>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Cliente</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Email</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Saldo</th>
                          </>
                        )}
                        {reportType === 'sales_by_product' && (
                          <>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Produto</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400">Barraca</th>
                            <th className="px-8 py-4 text-[10px] uppercase font-black tracking-widest text-slate-400 text-right">Preço</th>
                          </>
                        )}
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {reportType === 'financial_summary' && getFinancialSummary().map((row, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 group">
                         <td className="px-8 py-5 font-bold text-slate-700">{row.category}</td>
                         <td className="px-8 py-5 text-right font-black text-slate-900">{formatCurrency(row.amount)}</td>
                       </tr>
                     ))}
                     {reportType === 'sales_by_stall' && getSalesByStall().map((row, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 group">
                         <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                               <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-xs uppercase">
                                  {row.stallName.charAt(0)}
                               </div>
                               <span className="font-bold text-slate-700">{row.stallName}</span>
                            </div>
                         </td>
                         <td className="px-8 py-5 text-right font-medium text-slate-500">{row.transactionCount}</td>
                         <td className="px-8 py-5 text-right font-black text-slate-900">{formatCurrency(row.totalSales)}</td>
                       </tr>
                     ))}
                     {reportType === 'transactions_log' && getTransactionsLog().map((row, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 group">
                         <td className="px-8 py-5 font-medium text-slate-500 text-xs">{row.date}</td>
                         <td className="px-8 py-5 font-bold text-slate-700">{row.user}</td>
                         <td className="px-8 py-5">
                            <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${
                              row.type === 'CARGA' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                               {row.type}
                            </span>
                         </td>
                         <td className={`px-8 py-5 text-right font-black ${
                           row.type === 'CARGA' ? 'text-green-600' : 'text-slate-900'
                         }`}>
                           {row.type === 'CARGA' ? '+' : '-'}{formatCurrency(row.amount)}
                         </td>
                       </tr>
                     ))}
                     {reportType === 'user_balances' && getUserBalances().map((row, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 group">
                         <td className="px-8 py-5">
                            <span className="font-bold text-slate-700 block">{row.name}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{row.role}</span>
                         </td>
                         <td className="px-8 py-5 text-slate-500 font-medium">{row.email}</td>
                         <td className="px-8 py-5 text-right font-black text-green-600">{formatCurrency(row.balance)}</td>
                       </tr>
                     ))}
                     {reportType === 'sales_by_product' && getSalesByProduct().map((row, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 group">
                         <td className="px-8 py-5 font-bold text-slate-700">{row.name}</td>
                         <td className="px-8 py-5 text-slate-500 font-medium">{row.stall}</td>
                         <td className="px-8 py-5 text-right font-black text-slate-900">{formatCurrency(row.price)}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </CardContent>
           </Card>
        </div>
      </div>
    </div>
  );
}
