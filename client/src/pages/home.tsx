import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, CheckCircle, Cookie, Code, Globe, Play, Settings, Loader2, RotateCcw, Search, Smartphone, Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CorsExecuteResponse {
  id: number;
  cookies: Record<string, string>;
  apiResponse: any;
  status: 'success' | 'error';
  error?: string;
}

export default function Home() {
  const [cookies, setCookies] = useState<Record<string, string>>({});
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [showProgress, setShowProgress] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [selectedCapacity, setSelectedCapacity] = useState<string>("");
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [loadingTariffs, setLoadingTariffs] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Extract device list from API response
  const extractDevices = (response: any) => {
    console.log('Extracting devices from response:', response);
    
    if (!response) return [];
    
    const devices: Array<{value: string, label: string, brand: string}> = [];
    
    // Get the device groups array
    const deviceGroups = response.deviceGroups || response.data?.deviceGroups || response.groups || [];
    
    if (Array.isArray(deviceGroups)) {
      deviceGroups.forEach((group: any, groupIndex: number) => {
        console.log(`Processing group ${groupIndex}:`, group);
        
        // Each group IS a device in this API structure
        if (group.name && group.leadDeviceVariantId) {
          const deviceName = group.name;
          const brand = group.make || 'Unknown';
          
          devices.push({
            value: group.leadDeviceVariantId,
            label: deviceName,
            brand: brand
          });
          
          console.log(`Added device: ${deviceName} (ID: ${group.leadDeviceVariantId})`);
        }
      });
    }
    
    console.log('Extracted devices:', devices);
    return devices;
  };

  const deviceList = apiResponse ? extractDevices(apiResponse) : [];
  
  // Get selected device details
  const getSelectedDeviceDetails = () => {
    if (!selectedDevice || !apiResponse?.deviceGroups) return null;
    
    return apiResponse.deviceGroups.find((group: any) => 
      group.leadDeviceVariantId === selectedDevice
    );
  };
  
  const selectedDeviceDetails = getSelectedDeviceDetails();
  
  // Get available capacities for selected device
  const getAvailableCapacities = () => {
    if (!selectedDeviceDetails?.capacity) return [];
    return selectedDeviceDetails.capacity.map((cap: string) => ({
      value: cap,
      label: cap
    }));
  };
  
  const availableCapacities = getAvailableCapacities();

  // Fetch tariffs for selected device and capacity
  const fetchTariffs = useMutation({
    mutationFn: async () => {
      if (!selectedDevice || !selectedCapacity) return [];
      
      const response = await apiRequest('POST', '/api/fetch-tariffs', {
        deviceId: selectedDevice,
        capacity: selectedCapacity,
        cookies: cookies
      });
      return response.json();
    },
    onMutate: () => {
      setLoadingTariffs(true);
      setTariffs([]);
    },
    onSuccess: (data) => {
      console.log('Complete pricing response:', data);
      
      // Extract plans from the API response
      const responseData = data.data || {};
      const plansArray = responseData.plans || [];
      
      console.log('Plans array:', plansArray);
      console.log('Number of plans found:', plansArray.length);
      
      // Transform the API response to match our interface
      const transformedPlans = plansArray.map((plan: any) => ({
        ...plan,
        // Add fields for easier display
        basePrice: plan.originalMonthlyPrice?.gross?.value,
        effectivePrice: plan.monthlyPrice?.gross?.value,
        dataAllowance: plan.allowances?.find((a: any) => a.type === 'DATA')?.value + ' ' + 
                      plan.allowances?.find((a: any) => a.type === 'DATA')?.uom,
        futurePrice: plan.bundlePriceRise?.[0] ? {
          amount: plan.bundlePriceRise[0].monthlyPrice?.gross,
          date: plan.bundlePriceRise[0].text
        } : null,
        futurePrices: plan.bundlePriceRise || []
      }));
      
      console.log('Transformed plans:', transformedPlans);
      setTariffs(transformedPlans);
      setDebugInfo(data.debug || null);
      setLoadingTariffs(false);
    },
    onError: (error) => {
      console.error('Failed to fetch tariffs:', error);
      setDebugInfo({ error: error.message });
      setLoadingTariffs(false);
    }
  });

  // Auto-fetch tariffs when device and capacity are selected
  useEffect(() => {
    if (selectedDevice && selectedCapacity && Object.keys(cookies).length > 0) {
      fetchTariffs.mutate();
    }
  }, [selectedDevice, selectedCapacity, cookies]);

  // URLs for API endpoint discovery
  const CONFIG = {
    mainUrl: 'https://www.vodafone.co.uk/web-shop/login/auth/session',
    journeyUrl: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-list/paym/v3/*playformsessionid*/device-groups-listing-journey?segment=Consumer',
    apiUrl: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-list/paym/v3/*playformsessionid*/device-groups-listing-journey/device-groups?pageNumber=0&pageSize=200&sort=priority'
  };

  const discoverMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/discover-endpoints', {
        mainUrl: CONFIG.mainUrl
      });
      return response;
    },
    onMutate: () => {
      setShowProgress(true);
      setCurrentStep(1);
      setError("");
      setApiResponse(null);
    },
    onSuccess: (data) => {
      setApiResponse(data);
      setCurrentStep(3);
    },
    onError: (error) => {
      setError(error.message || 'Failed to discover endpoints');
      setShowProgress(false);
    }
  });

  const executeMutation = useMutation({
    mutationFn: async (): Promise<CorsExecuteResponse> => {
      const response = await apiRequest('POST', '/api/cors-execute', {
        mainUrl: CONFIG.mainUrl,
        journeyUrl: CONFIG.journeyUrl,
        apiUrl: CONFIG.apiUrl
      });
      return response.json();
    },
    onMutate: () => {
      setShowProgress(true);
      setCurrentStep(1);
      setError("");
      setApiResponse(null);
    },
    onSuccess: (data) => {
      console.log('Success data received:', data);
      console.log('Cookies from response:', data.cookies);
      setCookies(data.cookies || {});
      setApiResponse(data.apiResponse);
      setCurrentStep(3);
      setShowProgress(false);
    },
    onError: (error) => {
      setError(error.message);
      setCurrentStep(0);
      setShowProgress(false);
    }
  });

  const handleExecute = () => {
    executeMutation.mutate();
  };

  const handleClear = () => {
    setCookies({});
    setApiResponse(null);
    setCurrentStep(0);
    setShowProgress(false);
    setError("");
  };

  const getStepStatus = (step: number) => {
    if (step < currentStep) return 'complete';
    if (step === currentStep && executeMutation.isPending) return 'loading';
    return 'pending';
  };

  const stepNames = [
    '',
    'Fetching cookies from main URL...',
    'Making API call with cookies...',
    'Process complete'
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Cookie className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">CORS Bypass Tool</h1>
              <p className="text-sm text-gray-500">Cookie Manager & API Proxy</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Status Banner */}
        {(executeMutation.isSuccess || error) && (
          <div className="mb-6">
            {executeMutation.isSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center space-x-3">
                <CheckCircle className="text-green-500" size={20} />
                <span className="text-green-700 text-sm font-medium">CORS bypass completed successfully</span>
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
                <AlertCircle className="text-red-500" size={20} />
                <span className="text-red-700 text-sm font-medium">{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Configuration Panel */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Settings className="text-gray-400" size={20} />
              <span>Configuration</span>
            </CardTitle>
            <p className="text-sm text-gray-500">Hardcoded URLs for cookie extraction and API calls</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Globe className="inline mr-2 text-gray-400" size={16} />
                Main URL (Cookie Source)
              </label>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <code className="font-mono text-sm text-gray-800">{CONFIG.mainUrl}</code>
                <div className="mt-1 text-xs text-gray-500">Cookies will be extracted from this domain</div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Code className="inline mr-2 text-gray-400" size={16} />
                API Endpoint
              </label>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <code className="font-mono text-sm text-gray-800">{CONFIG.apiUrl}</code>
                <div className="mt-1 text-xs text-gray-500">API calls will be made to this endpoint with extracted cookies</div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Cookie className="inline mr-2 text-gray-400" size={16} />
                Cookie Status
              </label>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${Object.keys(cookies).length > 0 ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                  <span className={`text-sm ${Object.keys(cookies).length > 0 ? 'text-green-600' : 'text-gray-600'}`}>
                    {Object.keys(cookies).length > 0 ? 'Cookies loaded successfully' : 'No cookies loaded'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">{Object.keys(cookies).length} cookies available</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Panel */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Play className="text-gray-400" size={20} />
              <span>Actions</span>
            </CardTitle>
            <p className="text-sm text-gray-500">Execute the CORS bypass process</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button 
                onClick={handleExecute}
                disabled={executeMutation.isPending}
                className="w-full"
                size="lg"
              >
                {executeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Extract Cookies & Build URL
                  </>
                )}
              </Button>

              <Button 
                onClick={handleClear}
                variant="outline"
                className="w-full"
                disabled={executeMutation.isPending}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Clear All
              </Button>

              {/* Progress Steps */}
              {showProgress && (
                <div className="space-y-3 pt-4 border-t">
                  {[1, 2, 3].map((step) => {
                    const status = getStepStatus(step);
                    return (
                      <div key={step} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center">
                          {status === 'complete' && (
                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                              <CheckCircle className="text-white" size={12} />
                            </div>
                          )}
                          {status === 'loading' && (
                            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                          )}
                          {status === 'pending' && (
                            <div className="w-6 h-6 bg-gray-300 rounded-full"></div>
                          )}
                        </div>
                        <span className="text-sm text-gray-600">{stepNames[step]}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cookie Extraction Results */}
        {(Object.keys(cookies).length > 0 || executeMutation.isSuccess) && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Cookie className="text-gray-400" size={20} />
                <span>Extracted Cookies & Generated URL</span>
              </CardTitle>
              <p className="text-sm text-gray-500">Authentication cookies and dynamic URL with platform session ID</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Platform Session ID */}
              {cookies['platformSessionId'] && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Platform Session ID
                  </label>
                  <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                    <code className="font-mono text-sm text-green-700">{cookies['platformSessionId']}</code>
                    <div className="mt-1 text-xs text-green-600">✓ Successfully extracted from auth token</div>
                  </div>
                </div>
              )}

              {/* Generated API URL */}
              {cookies['platformSessionId'] && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Generated API URL
                  </label>
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <code className="font-mono text-sm text-blue-700 break-all">
                      {CONFIG.apiUrl.replace('*playformsessionid*', cookies['platformSessionId'])}
                    </code>
                    <div className="mt-1 text-xs text-blue-600">✓ Platform session ID inserted into URL template</div>
                  </div>
                </div>
              )}

              {/* Authentication Cookies */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Authentication Cookies ({Object.keys(cookies).filter(name => name !== 'platformSessionId').length})
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {Object.entries(cookies)
                    .filter(([name]) => name !== 'platformSessionId')
                    .map(([name, value]) => (
                    <div key={name} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-mono text-sm font-medium text-gray-900">{name}</div>
                          <div className="font-mono text-xs text-gray-600 mt-1 break-all">{value.substring(0, 100)}{value.length > 100 ? '...' : ''}</div>
                          <div className="mt-1">
                            {name.includes('eShop-auth') && <Badge variant="outline" className="text-xs">Auth Token</Badge>}
                            {name.includes('JSESSIONID') && <Badge variant="outline" className="text-xs">Session</Badge>}
                            {name.includes('TS') && <Badge variant="outline" className="text-xs">Tracking</Badge>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button for Testing the URL */}
              {cookies['platformSessionId'] && (
                <div className="pt-4 border-t border-gray-200">
                  <Button 
                    onClick={() => {
                      const finalUrl = CONFIG.apiUrl.replace('*playformsessionid*', cookies['platformSessionId']);
                      window.open(finalUrl, '_blank');
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    Test Generated URL in Browser
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Status Panel */}
        {(error || apiResponse) && (
          <Card>
            <CardContent className="pt-6">
              {error && (
                <div className="flex items-center space-x-3 text-red-600 bg-red-50 p-4 rounded-lg border border-red-200">
                  <AlertCircle className="h-5 w-5" />
                  <div className="flex-1">
                    <span className="font-medium">Error: {error}</span>
                  </div>
                  <Button 
                    onClick={handleExecute}
                    variant="outline" 
                    size="sm"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Try Again
                  </Button>
                </div>
              )}
              
              {apiResponse && !error && (
                <div className="flex items-center space-x-3 text-green-600 bg-green-50 p-4 rounded-lg border border-green-200">
                  <CheckCircle className="h-5 w-5" />
                  <div className="flex-1">
                    <span className="font-medium">Device data loaded successfully!</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {deviceList.length} devices found
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Device Selector */}
        {deviceList.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Smartphone className="text-gray-400" size={20} />
                <span>Select Device</span>
              </CardTitle>
              <p className="text-sm text-gray-500">Choose a device from the available options</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a device..." />
                  </SelectTrigger>
                  <SelectContent>
                    {deviceList.map((device) => (
                      <SelectItem key={device.value} value={device.value}>
                        <div className="flex items-center space-x-2">
                          <Smartphone className="h-4 w-4" />
                          <span>{device.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedDevice && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center space-x-2 mb-2">
                      <CheckCircle className="h-5 w-5 text-blue-600" />
                      <h3 className="font-medium text-blue-900">Selected Device</h3>
                    </div>
                    <p className="text-blue-800">
                      {deviceList.find(d => d.value === selectedDevice)?.label}
                    </p>
                    <Badge variant="secondary" className="mt-2">
                      {deviceList.find(d => d.value === selectedDevice)?.brand}
                    </Badge>
                  </div>
                )}

                {/* Capacity Selector */}
                {selectedDevice && availableCapacities.length > 0 && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Storage Capacity
                    </label>
                    <Select value={selectedCapacity} onValueChange={setSelectedCapacity}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select storage capacity..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCapacities.map((capacity: any) => (
                          <SelectItem key={capacity.value} value={capacity.value}>
                            {capacity.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Tariff Loading State */}
                {loadingTariffs && selectedDevice && selectedCapacity && (
                  <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-yellow-800">Loading live tariff data...</span>
                    </div>
                  </div>
                )}

                {/* Debug Information */}
                {debugInfo && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center space-x-2 mb-3">
                      <Info className="h-5 w-5 text-blue-600" />
                      <h3 className="font-medium text-blue-900">API Debug Information</h3>
                    </div>
                    <div className="space-y-2 text-sm">
                      {debugInfo.journeyUrl && (
                        <div>
                          <strong>1. Journey Creation URL:</strong> 
                          <div className="font-mono text-xs bg-white p-2 rounded mt-1 break-all">
                            POST {debugInfo.journeyUrl}
                          </div>
                        </div>
                      )}
                      {debugInfo.deviceSelectionUrl && (
                        <div>
                          <strong>2. Device Selection URL:</strong>
                          <div className="font-mono text-xs bg-white p-2 rounded mt-1 break-all">
                            PUT {debugInfo.deviceSelectionUrl}
                          </div>
                        </div>
                      )}
                      {debugInfo.customerActionUrl && (
                        <div>
                          <strong>3. Customer Action URL:</strong>
                          <div className="font-mono text-xs bg-white p-2 rounded mt-1 break-all">
                            POST {debugInfo.customerActionUrl}
                            <div className="text-gray-500 mt-1">Body: {"{"}"isExisting": false{"}"}</div>
                          </div>
                        </div>
                      )}
                      {debugInfo.tariffsUrl && (
                        <div>
                          <strong>4. Tariffs/Plans URL:</strong>
                          <div className="font-mono text-xs bg-white p-2 rounded mt-1 break-all">
                            GET {debugInfo.tariffsUrl}
                          </div>
                        </div>
                      )}
                      {debugInfo.journeyId && (
                        <div>
                          <strong>Journey ID:</strong> <span className="font-mono">{debugInfo.journeyId}</span>
                        </div>
                      )}
                      {debugInfo.error && (
                        <div className="text-red-600">
                          <strong>Error:</strong> {debugInfo.error}
                        </div>
                      )}
                      {debugInfo.responseStatus && (
                        <div>
                          <strong>Final Response Status:</strong> <span className={debugInfo.responseStatus === 200 ? 'text-green-600' : 'text-red-600'}>{debugInfo.responseStatus}</span>
                        </div>
                      )}
                      {debugInfo.journeyData && (
                        <div>
                          <strong>Journey Creation Response:</strong>
                          <div className="font-mono text-xs bg-white p-2 rounded mt-1 max-h-32 overflow-y-auto">
                            <pre>{JSON.stringify(debugInfo.journeyData, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                      {debugInfo.tariffsError && (
                        <div>
                          <strong>Tariffs API Error:</strong>
                          <div className="font-mono text-xs bg-red-50 p-2 rounded mt-1 text-red-800">
                            {debugInfo.tariffsError}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tariff Data Display */}
                {((tariffs.length > 0) || (debugInfo && debugInfo.responseStatus === 200)) && !loadingTariffs && (
                  <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center space-x-2 mb-3">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <h3 className="font-medium text-green-900">Live Tariff Data</h3>
                    </div>
                    <div className="space-y-3">
                      {tariffs.slice(0, 5).map((tariff: any, index: number) => (
                        <div key={index} className="bg-white p-3 rounded border">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-medium text-gray-900">
                                {tariff.name || tariff.planName || `Plan ${index + 1}`}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {tariff.description || tariff.planType || 'Monthly Plan'}
                              </p>
                              {tariff.dataAllowance && (
                                <p className="text-sm text-blue-600">
                                  Data: {tariff.dataAllowance}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              {tariff.basePrice && tariff.effectivePrice && tariff.basePrice !== tariff.effectivePrice ? (
                                <div>
                                  <div className="text-sm text-gray-500 line-through">
                                    £{tariff.basePrice}/month
                                  </div>
                                  <div className="text-lg font-bold text-green-600">
                                    £{tariff.effectivePrice}/month
                                  </div>
                                  {tariff.primaryPromotion && (
                                    <div className="text-xs text-blue-600">
                                      Save £{tariff.primaryPromotion.savingsAmount?.gross?.value} for {tariff.primaryPromotion.duration?.value} months
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-lg font-bold text-green-600">
                                  £{tariff.effectivePrice || tariff.monthlyPrice?.gross?.value || 'N/A'}/month
                                </div>
                              )}
                              {tariff.oneOffPrice?.gross?.value && (
                                <div className="text-sm text-gray-600">
                                  £{tariff.oneOffPrice.gross.value} upfront
                                </div>
                              )}
                              {tariff.futurePrices && tariff.futurePrices.length > 0 && (
                                <div className="text-xs text-orange-600">
                                  {tariff.futurePrices
                                    .filter((future: any, index: number, arr: any[]) => 
                                      index === arr.findIndex(f => f.text === future.text)
                                    )
                                    .slice(0, 2)
                                    .map((future: any, index: number) => (
                                      <div key={index}>
                                        {future.text}: £{future.monthlyPrice?.gross}/month
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>
                          {tariff.features && (
                            <div className="mt-2 text-sm text-gray-600">
                              Features: {Array.isArray(tariff.features) ? tariff.features.join(', ') : 
                                typeof tariff.features === 'object' ? JSON.stringify(tariff.features) : tariff.features}
                            </div>
                          )}
                        </div>
                      ))}
                      {tariffs.length > 5 && (
                        <p className="text-sm text-gray-600 text-center">
                          Showing 5 of {tariffs.length} available tariffs
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {selectedDeviceDetails && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center space-x-2 mb-3">
                      <Code className="h-5 w-5 text-gray-600" />
                      <h3 className="font-medium text-gray-900">Device Details (JSON)</h3>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-x-auto max-h-96">
                      <pre className="text-green-400">
                        {JSON.stringify(selectedDeviceDetails, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {deviceList.length > 0 && (
                  <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                    <p className="font-medium mb-1">Available Devices: {deviceList.length}</p>
                    <p>Brands found in device list</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-8 text-center border-t border-gray-200 mt-12">
        <div className="text-sm text-gray-500">
          <p className="mb-2">⚠️ This tool is for development and testing purposes only</p>
          <p>Ensure you have proper authorization before using with any external services</p>
        </div>
      </footer>
    </div>
  );
}
