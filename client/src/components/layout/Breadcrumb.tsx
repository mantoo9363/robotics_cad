import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export const Breadcrumb: React.FC = () => {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  if (pathnames.length === 0) {
    return (
      <nav className="flex text-sm text-slate-500 my-4 px-6">
        <span className="flex items-center text-indigo-600 font-medium">
          <Home className="w-4 h-4 mr-1" />
          Studio
        </span>
      </nav>
    );
  }

  return (
    <nav className="flex text-sm text-slate-500 my-4 px-6">
      <Link to="#" className="flex items-center hover:text-indigo-600 transition-colors">
        <Home className="w-4 h-4 mr-1" />
        Studio
      </Link>
      
      {pathnames.map((value, index) => {
        const to = `/${pathnames.slice(0, index + 1).join('/')}`;
        const isLast = index === pathnames.length - 1;
        const name = value.charAt(0).toUpperCase() + value.slice(1);

        return (
          <div key={to} className="flex items-center">
            <ChevronRight className="w-4 h-4 mx-2 text-slate-400" />
            {isLast ? (
              <span className="text-slate-900 font-medium">{name}</span>
            ) : (
              <Link to={to} className="hover:text-indigo-600 transition-colors">
                {name}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
};
