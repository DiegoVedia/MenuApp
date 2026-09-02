import { Navigate, Route, Routes } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import PrivateRoute from './components/PrivateRoute.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import MealsPage from './pages/MealsPage.jsx';
import MealFormPage from './pages/MealFormPage.jsx';
import ImportRecipePage from './pages/ImportRecipePage.jsx';
import PantryPage from './pages/PantryPage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import MenuPage from './pages/MenuPage.jsx';
import ShoppingListsPage from './pages/ShoppingListsPage.jsx';
import ShoppingListDetailPage from './pages/ShoppingListDetailPage.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <div className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/meals" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route path="/meals" element={<PrivateRoute><MealsPage /></PrivateRoute>} />
          <Route path="/meals/new" element={<PrivateRoute><MealFormPage /></PrivateRoute>} />
          <Route path="/meals/:id/edit" element={<PrivateRoute><MealFormPage /></PrivateRoute>} />
          <Route path="/import" element={<PrivateRoute><ImportRecipePage /></PrivateRoute>} />
          <Route path="/pantry" element={<PrivateRoute><PantryPage /></PrivateRoute>} />
          <Route path="/preferences" element={<PrivateRoute><PreferencesPage /></PrivateRoute>} />
          <Route path="/menu" element={<PrivateRoute><MenuPage /></PrivateRoute>} />
          <Route path="/shopping-lists" element={<PrivateRoute><ShoppingListsPage /></PrivateRoute>} />
          <Route path="/shopping-lists/:id" element={<PrivateRoute><ShoppingListDetailPage /></PrivateRoute>} />

          <Route path="*" element={<Navigate to="/meals" replace />} />
        </Routes>
      </div>
    </div>
  );
}
