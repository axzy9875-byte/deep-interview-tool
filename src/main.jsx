// import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { MantineProvider } from '@mantine/core';
import { Toaster } from 'react-hot-toast';
import Home from './pages/index.jsx';
import AdminPage from './pages/admin.jsx';
import PublicInterviewPage from './pages/publicInterview.jsx';
// import {NextUIProvider} from "@nextui-org/react";
import './index.scss'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '/interview', element: <Navigate to="/admin" replace /> },
  { path: '/join/:campaignId', element: <PublicInterviewPage /> },
  { path: '*', element: <Navigate to="/" replace /> }
]);

ReactDOM.createRoot(document.getElementById('root')).render(<MantineProvider><RouterProvider router={router} /><Toaster/></MantineProvider>)
