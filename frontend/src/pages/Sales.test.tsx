import { expect,test,vi } from "vitest"
import { render,screen,within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient,QueryClientProvider } from "@tanstack/react-query"
import { getTransactions,type Transaction } from "@/services/transaction.service"
import { formatMoney } from "@/lib/format"
import Sales from "./Sales"
vi.mock("@/context/AuthContext",()=>({useAuth:()=>({activeBusinessId:"business-a"})}))
vi.mock("@/hooks/useActiveBusiness",()=>({useActiveBusiness:()=>({currency:"USD"})}))
vi.mock("@/services/transaction.service")
vi.mock("@/components/transactions/TransactionDetailSheet",()=>({TransactionDetailSheet:()=>null}))
test("shows balances only for credit sales, even when the API includes credit statistics on a cash sale",async()=>{
 const rows=[{id:"cash-sale",customerName:"Cash buyer",paymentMethod:"CASH",totalAmount:50,balanceDue:50,createdAt:"2026-11-12T10:00:00Z"},{id:"credit-sale",customerName:"Credit buyer",paymentMethod:"CREDIT",totalAmount:50,balanceDue:15,createdAt:"2026-11-12T10:00:00Z"}] as Transaction[]
 vi.mocked(getTransactions).mockResolvedValue({transactions:rows,pagination:{total:2,page:1,limit:20,totalPages:1}})
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Sales/></MemoryRouter></QueryClientProvider>)
 const cashRow=(await screen.findByText("Cash buyer")).closest("tr")!
 const creditRow=screen.getByText("Credit buyer").closest("tr")!
 expect(within(cashRow).getAllByRole("cell")[5]).toHaveTextContent(formatMoney(0,"USD"))
 expect(within(creditRow).getAllByRole("cell")[5]).toHaveTextContent(formatMoney(15,"USD"))
})
