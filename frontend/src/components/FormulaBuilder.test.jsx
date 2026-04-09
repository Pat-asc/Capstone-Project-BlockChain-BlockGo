import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FormulaBuilder from './FormulaBuilder';

// Mock the global fetch API
global.fetch = jest.fn();

describe('FormulaBuilder Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock localStorage for the token
    Storage.prototype.getItem = jest.fn(() => 'mock-jwt-token');
    
    // Mock window.alert to prevent popups during tests
    window.alert = jest.fn();
  });

  it('renders the initial UI and default columns correctly', () => {
    render(<FormulaBuilder />);
    
    expect(screen.getByText('Create Grade Template')).toBeInTheDocument();
    expect(screen.getByText(/A: Student Name/)).toBeInTheDocument();
    
    // Verify default columns C, D, E are loaded
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Quiz 1')).toBeInTheDocument();
    
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Exam 1')).toBeInTheDocument();
    
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Final Grade')).toBeInTheDocument();
  });

  it('updates the template name input field', () => {
    render(<FormulaBuilder />);
    
    const input = screen.getByPlaceholderText('Template Name (e.g. standard-it-grading)');
    fireEvent.change(input, { target: { value: 'Midterm IT Template' } });
    
    expect(input.value).toBe('Midterm IT Template');
  });

  it('adds a new raw score column correctly', () => {
    render(<FormulaBuilder />);
    
    const addRawBtn = screen.getByText('+ Add Raw Score Col');
    fireEvent.click(addRawBtn);
    
    // The next logical column after 'E' is 'F'
    expect(screen.getByText('F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('New input')).toBeInTheDocument();
  });

  it('successfully submits the payload to the API', async () => {
    // Setup mock successful fetch response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Template submitted for approval successfully!' }),
    });

    render(<FormulaBuilder />);
    
    // Fill out the required template name
    const nameInput = screen.getByPlaceholderText('Template Name (e.g. standard-it-grading)');
    fireEvent.change(nameInput, { target: { value: 'Test Template' } });

    // Submit the form
    const submitBtn = screen.getByText('Submit for Approval');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('/api/GradeTemplate/create', expect.any(Object));
      expect(window.alert).toHaveBeenCalledWith('Template submitted for approval successfully!');
    });
  });
});