import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'

export function ProtectedRoute({ children, adminOnly = false }) {
  const { isAuthenticated, user } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (adminOnly && user?.role !== 'admin' && user?.role !== 'super-admin') {
    return <Navigate to="/dashboard" replace />
  }
  return children
}
