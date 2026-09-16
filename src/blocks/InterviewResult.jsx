import React, { useEffect, useState } from 'react';
import { 
  Card, 
  Stack, 
  Group, 
  Text, 
  Title, 
  Button,
  Badge,
  Alert,
  Textarea,
  Select,
  ActionIcon,
  Tooltip,
  Modal,
  Progress,
  Divider,
  Tabs
} from '@mantine/core';
import { 
  IconDownload,
  IconRefresh,
  IconCheck,
  IconCopy,
  IconFile,
  IconFileText,
  IconMarkdown,
  IconAlertCircle,
  IconEye,
  IconEdit,
  IconArrowRight,
  IconBolt,
  IconSettings
} from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useInterviewStore } from '../hooks/useInterviewStore.jsx';

export function InterviewResult() {
  const { 
    resultState, 
    sessionState,
    contentState,
    // 提纲生成
    generateInterviewOutline,
    generateInterviewOutlineStream,
    // 章节生成
    generateSectionContent,
    generateSectionContentStream,
    generateAllSections,
    // 初稿合并
    generateDraftScript,
    // 风格润色
    generateFinalScript,
    generateFinalScriptStream,
    // 快速模式
    generateInterviewScriptWithStyle,
    switchGenerationMode,
    // 统一管理
    updateResultState,
    resetInterview
  } = useInterviewStore();

  const [exportFormat, setExportFormat] = useState('markdown');
  const [selectedStyle, setSelectedStyle] = useState('default');
  const [currentStep, setCurrentStep] = useState(1); // 1:提纲 2:章节 3:初稿 4:润色
  const [sectionProgress, setSectionProgress] = useState({ current: 0, total: 0 });
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(null); // 用于预览章节
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [activeMode, setActiveMode] = useState(resultState.generationMode || 'outline'); // 'outline' | 'quick'
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false); // 重置确认框

  // 写作风格选项
  const styleOptions = [
    { value: 'default', label: '默认风格', description: '亲和生动，深度人物特稿' },
    { value: 'qa', label: '问答风格', description: '完整保留全部原始问答并按顺序整理，不调用 AI' },
    { value: 'emotional', label: '情感风格', description: '情感充沛，直击痛点，引发共鸣' },
    { value: 'tech', label: '科技风格', description: '理性客观，实用导向，专业深度' },
    { value: 'literary', label: '文学风格', description: '文学性强，诗意优美，哲理思辨' },
    { value: 'business', label: '商业风格', description: '数据驱动，分析深入，实操性强' }
  ];

  // 第一步：生成提纲
  const handleGenerateOutline = async () => {
    try {
      await generateInterviewOutlineStream('default', (chunk, fullContent) => {
        // 实时更新显示
      });
      setCurrentStep(2);
    } catch (error) {
      console.error('Failed to generate outline:', error);
    }
  };
  
  // 第二步：生成单个章节
  const handleGenerateSection = async (sectionIndex) => {
    try {
      await generateSectionContentStream(sectionIndex, (chunk, fullContent, index) => {
        // 实时更新显示
      });
    } catch (error) {
      console.error(`Failed to generate section ${sectionIndex}:`, error);
    }
  };
  
  // 第二步：生成所有章节
  const handleGenerateAllSections = async () => {
    try {
      setIsGeneratingAll(true);
      setSectionProgress({ current: 0, total: resultState.outline?.outline?.length || 0 });
      
      await generateAllSections((current, total) => {
        setSectionProgress({ current, total });
      });
      
      setCurrentStep(3);
    } catch (error) {
      console.error('Failed to generate all sections:', error);
    } finally {
      setIsGeneratingAll(false);
      setSectionProgress({ current: 0, total: 0 });
    }
  };
  
  // 第三步：合并初稿
  const handleGenerateDraft = () => {
    try {
      console.log('开始合并初稿，当前步骤：', currentStep);
      const draft = generateDraftScript();
      if (draft) {
        console.log('初稿生成成功，切换到润色步骤');
        setCurrentStep(4);
      }
    } catch (error) {
      console.error('Failed to generate draft:', error);
    }
  };
  
  // 第四步：风格润色
  const handleGenerateFinal = async (style = selectedStyle) => {
    try {
      setSelectedStyle(style);
      await generateFinalScriptStream(style, (chunk, fullContent, currentStyle) => {
        // 实时更新显示
      });
    } catch (error) {
      console.error('Failed to generate final script:', error);
    }
  };
  
  // 快速模式：直接生成访谈稿
  const handleQuickGenerate = async (style = selectedStyle) => {
    try {
      setSelectedStyle(style);
      // 确保切换到快速模式tab
      if (activeMode !== 'quick') {
        setActiveMode('quick');
        switchGenerationMode('quick');
      }
      await generateInterviewScriptWithStyle(style);
    } catch (error) {
      console.error('Failed to generate quick script:', error);
    }
  };
  
  // 导出访谈稿
  const handleExportInterviewScript = (format = 'markdown') => {
    let content = '';
    let filename = '';
    
    // 根据模式获取内容
    if (activeMode === 'quick' && resultState.interviewScripts[selectedStyle]) {
      content = resultState.interviewScripts[selectedStyle].content;
      filename = `访谈稿_${selectedStyle}风格_${new Date().toISOString().split('T')[0]}.md`;
    } else if (activeMode === 'outline' && resultState.finalScripts[selectedStyle]) {
      content = resultState.finalScripts[selectedStyle].content;
      filename = `访谈稿_${selectedStyle}风格_${new Date().toISOString().split('T')[0]}.md`;
    } else {
      alert('请先生成访谈稿');
      return;
    }
    
    // 创建下载链接
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  // 导出原始问答记录
  const handleExportRawQA = () => {
    if (!sessionState.questions || sessionState.questions.length === 0) {
      alert('没有问答记录可导出');
      return;
    }
    
    // 构建原始问答内容
    let content = `# 访谈问答记录\n\n`;
    content += `生成时间：${new Date().toLocaleString()}\n`;
    content += `问题数量：${sessionState.questions.length}\n`;
    content += `已回答：${Object.keys(sessionState.answers).length}\n\n`;
    content += `---\n\n`;
    
    sessionState.questions.forEach((question, index) => {
      const answer = sessionState.answers[question.id];
      content += `## 问题 ${index + 1}\n\n`;
      content += `**问题：** ${question.content}\n\n`;
      if (question.category) {
        content += `**分类：** ${question.category}\n\n`;
      }
      content += `**回答：** ${answer ? answer.content : '（未回答）'}\n\n`;
      if (answer && answer.timestamp) {
        content += `**回答时间：** ${new Date(answer.timestamp).toLocaleString()}\n\n`;
      }
      content += `---\n\n`;
    });
    
    // 创建下载链接
    const filename = `访谈问答记录_${new Date().toISOString().split('T')[0]}.txt`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  // 切换生成模式
  const handleModeSwitch = (mode) => {
    setActiveMode(mode);
    // 快速模式传递'quick'，精细模式传递'outline'
    const generationMode = mode === 'quick' ? 'quick' : 'outline';
    switchGenerationMode(generationMode);
    
    // 重置相关状态
    if (mode === 'quick') {
      setCurrentStep(1); // 快速模式直接到风格选择
    } else {
      // 精细模式根据当前数据状态决定步骤
      if (resultState.finalScripts && Object.keys(resultState.finalScripts).length > 0) {
        setCurrentStep(4);
      } else if (resultState.draftScript) {
        setCurrentStep(4);
      } else if (resultState.sections && Object.keys(resultState.sections).length > 0) {
        setCurrentStep(3);
      } else if (resultState.outline) {
        setCurrentStep(2);
      } else {
        setCurrentStep(1);
      }
    }
  };
  
  // 处理重置访谈确认
  const handleResetConfirm = () => {
    resetInterview();
    setResetConfirmOpen(false);
  };
  
  // 预览章节内容
  const handlePreviewSection = (sectionIndex) => {
    setSelectedSectionIndex(sectionIndex);
    setPreviewModalOpen(true);
  };
  
  // 关闭预览
  const handleClosePreview = () => {
    setSelectedSectionIndex(null);
    setPreviewModalOpen(false);
  };

  // 初始化时判断当前应该在哪一步
  useEffect(() => {
    // 同步生成模式
    const mode = resultState.generationMode || 'outline';
    setActiveMode(mode);
    
    // 如果是快速模式，不需要设置步骤
    if (mode === 'quick' || mode === 'full') {
      return;
    }
    
    // 精细模式的步骤判断
    if (resultState.finalScripts && Object.keys(resultState.finalScripts).length > 0) {
      setCurrentStep(4); // 已有最终稿
    } else if (resultState.draftScript) {
      setCurrentStep(4); // 有初稿，可以进行润色
    } else if (resultState.sections && Object.keys(resultState.sections).length > 0) {
      const totalSections = resultState.outline?.outline?.length || 0;
      const completedSections = Object.keys(resultState.sections).length;
      if (completedSections === totalSections && totalSections > 0) {
        setCurrentStep(3); // 所有章节已完成，可以合并
      } else {
        setCurrentStep(2); // 部分章节已完成
      }
    } else if (resultState.outline) {
      setCurrentStep(2); // 有提纲，可以生成章节
    } else {
      setCurrentStep(1); // 开始生成提纲
      // 自动生成提纲
      if (!resultState.isGeneratingOutline) {
        handleGenerateOutline();
      }
    }
  }, [resultState.generationMode]);

  return (
    <div style={{ position: 'relative' }}>
      {/* 模式选择 */}
      <Card withBorder padding="md" mb="md">
        <Title order={2} mb="md">访谈稿生成流程</Title>
        
        <Tabs 
          value={activeMode} 
          onTabChange={handleModeSwitch}
          mb="md"
        >
          <Tabs.List>
            <Tabs.Tab value="quick" icon={<IconBolt size={16} />}>
              快速模式
            </Tabs.Tab>
            <Tabs.Tab value="outline" icon={<IconSettings size={16} />}>
              精细模式
            </Tabs.Tab>
          </Tabs.List>
          
          <Tabs.Panel value="quick" pt="sm">
            <Alert color="blue" variant="light" mb="md">
              <Text size="sm">
                <strong>快速模式</strong>：问答记录 → 风格润色（约2-3分钟，适合快速出稿、保持原始对话风格）
              </Text>
            </Alert>
          </Tabs.Panel>
          
          <Tabs.Panel value="outline" pt="sm">
            <Alert color="green" variant="light" mb="md">
              <Text size="sm">
                <strong>精细模式</strong>：生成提纲 → 章节生成 → 合并初稿 → 风格润色（约5-10分钟，适合深度文章、结构化内容、丰富细节）
              </Text>
            </Alert>
          </Tabs.Panel>
        </Tabs>
      </Card>
      
      {/* 流程步骤指示器 */}
      {activeMode === 'outline' && (
        <Card withBorder padding="md" mb="md">
          <Title order={3} mb="md">精细模式流程</Title>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          {[
            { step: 1, title: '生成提纲', desc: '分析内容生成文章结构' },
            { step: 2, title: '章节写作', desc: '按提纲逐章节生成内容' },
            { step: 3, title: '合并初稿', desc: '整合所有章节为完整初稿' },
            { step: 4, title: '风格润色', desc: '按不同风格进行二次加工' }
          ].map((item, index) => (
            <div key={item.step} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              flex: 1,
              opacity: currentStep >= item.step ? 1 : 0.5
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: currentStep >= item.step ? '#228be6' : '#e9ecef',
                color: currentStep >= item.step ? 'white' : '#868e96',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                marginRight: '12px'
              }}>
                {currentStep > item.step ? '✓' : item.step}
              </div>
              <div style={{ flex: 1 }}>
                <Text weight={600} size="sm" color={currentStep >= item.step ? 'dark' : 'dimmed'}>
                  {item.title}
                </Text>
                <Text size="xs" color="dimmed">
                  {item.desc}
                </Text>
              </div>
              {index < 3 && (
                <div style={{
                  width: '60px',
                  height: '2px',
                  backgroundColor: currentStep > item.step ? '#228be6' : '#e9ecef',
                  margin: '0 16px'
                }} />
              )}
            </div>
          ))}
        </div>
        
        {/* 统计信息 */}
        <Group spacing="xl">
          <div>
            <Text size="xl" weight={700} color="blue">
              {sessionState.questions?.length || 0}
            </Text>
            <Text size="xs" color="dimmed">问题数</Text>
          </div>
          <div>
            <Text size="xl" weight={700} color="green">
              {Object.keys(sessionState.answers || {}).length}
            </Text>
            <Text size="xs" color="dimmed">已回答</Text>
          </div>
          {resultState.draftScript && (
            <div>
              <Text size="xl" weight={700} color="orange">
                {resultState.draftScript.wordCount || 0}
              </Text>
              <Text size="xs" color="dimmed">初稿字数</Text>
            </div>
          )}
          {resultState.finalScripts[selectedStyle] && (
            <div>
              <Text size="xl" weight={700} color="purple">
                {resultState.finalScripts[selectedStyle].wordCount || 0}
              </Text>
              <Text size="xs" color="dimmed">最终字数</Text>
            </div>
          )}
        </Group>
        </Card>
      )}
      
      {/* 快速模式内容 */}
      {activeMode === 'quick' && (
        <Card withBorder padding="md" mb="md">
          <Title order={3} mb="md">快速模式</Title>
          <Group spacing="xl" mb="md">
            <div>
              <Text size="xl" weight={700} color="blue">
                {sessionState.questions?.length || 0}
              </Text>
              <Text size="xs" color="dimmed">问题数</Text>
            </div>
            <div>
              <Text size="xl" weight={700} color="green">
                {Object.keys(sessionState.answers || {}).length}
              </Text>
              <Text size="xs" color="dimmed">已回答</Text>
            </div>
            {resultState.interviewScripts[selectedStyle] && (
              <div>
                <Text size="xl" weight={700} color="purple">
                  {resultState.interviewScripts[selectedStyle].wordCount || 0}
                </Text>
                <Text size="xs" color="dimmed">访谈稿字数</Text>
              </div>
            )}
          </Group>
          
          {/* 快速模式风格选择器 */}
          <Card withBorder padding="md" style={{ backgroundColor: '#f8f9fa' }}>
            <Group position="apart" align="flex-start">
              <div style={{ flex: 1 }}>
                <Title order={5} mb="sm">选择写作风格</Title>
                <Text size="sm" color="dimmed" mb="md">
                  直接对问答记录进行风格润色（快速模式）
                </Text>
                
                {/* 风格选择器 */}
                <Group spacing="xs" mb="md">
                  {styleOptions.map((style) => (
                    <Button
                      key={style.value}
                      variant={selectedStyle === style.value ? 'filled' : 'light'}
                      size="sm"
                      onClick={() => setSelectedStyle(style.value)}
                    >
                      {style.label}
                    </Button>
                  ))}
                </Group>
                
                <Text size="xs" color="dimmed" mb="md">
                  当前风格：{styleOptions.find(s => s.value === selectedStyle)?.description || '默认风格'}
                </Text>
              </div>
              
              {/* 生成按钮 */}
              <div style={{ minWidth: '140px' }}>
                <Button
                  size="md"
                  onClick={() => handleQuickGenerate(selectedStyle)}
                  loading={resultState.isGenerating}
                  leftIcon={<IconBolt size={16} />}
                  disabled={Object.keys(sessionState.answers || {}).length < (sessionState.questionMode === 'outline' ? Math.max(1, sessionState.questions.length) : 5)}
                  style={{ width: '100%' }}
                >
                  生成访谈稿
                </Button>
                
                {Object.keys(sessionState.answers || {}).length < (sessionState.questionMode === 'outline' ? Math.max(1, sessionState.questions.length) : 5) && (
                  <Text size="xs" color="dimmed" align="center" mt="xs">
                    {sessionState.questionMode === 'outline' ? '请先完成提纲中的问题' : '至少需要5个问题后才能生成'}
                  </Text>
                )}
                
                {resultState.interviewScripts[selectedStyle] && (
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => handleQuickGenerate(selectedStyle)}
                    leftIcon={<IconRefresh size={14} />}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    重新生成
                  </Button>
                )}
              </div>
            </Group>
          </Card>
          
          {/* 流式生成的访谈稿 */}
          {resultState.streamingScript && (
            <Card withBorder padding="md" mb="md" style={{ backgroundColor: '#f0f9ff' }}>
              <Text size="sm" weight={600} mb="xs">正在生成 {selectedStyle} 风格的访谈稿...</Text>
              <div style={{ 
                maxHeight: '400px', 
                overflowY: 'auto',
                fontSize: '14px',
                lineHeight: '1.5'
              }}>
                <ReactMarkdown>
                  {resultState.streamingScript.content}
                </ReactMarkdown>
              </div>
            </Card>
          )}
          
          {/* 最终访谈稿内容 */}
          {resultState.interviewScripts[selectedStyle] && !resultState.streamingScript && (
            <Card withBorder padding="md" mb="md">
              <Group position="apart" mb="md">
                <Text weight={600}>访谈稿（{selectedStyle} 风格）</Text>
                <Group spacing="xs">
                  <Text size="xs" color="dimmed">
                    {resultState.interviewScripts[selectedStyle].wordCount} 字
                  </Text>
                  {selectedStyle === 'qa' && resultState.interviewScripts[selectedStyle].sourceQuestionCount && (
                    <Badge color="green" variant="light">
                      已完整包含 {resultState.interviewScripts[selectedStyle].sourceQuestionCount}/{sessionState.questions.length} 组问答
                    </Badge>
                  )}
                  {/* 导出按钮 */}
                  <Button
                    size="xs"
                    variant="light"
                    leftIcon={<IconDownload size={12} />}
                    onClick={() => handleExportInterviewScript('markdown')}
                  >
                    导出Markdown
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    leftIcon={<IconFileText size={12} />}
                    onClick={() => handleExportRawQA()}
                  >
                    导出原始问答
                  </Button>
                </Group>
              </Group>
              
              <div style={{ 
                maxHeight: '500px', 
                overflowY: 'auto', 
                border: '1px solid #eee', 
                borderRadius: '8px', 
                padding: '16px',
                backgroundColor: '#fafafa'
              }}>
                <ReactMarkdown>
                  {resultState.interviewScripts[selectedStyle].content}
                </ReactMarkdown>
              </div>
            </Card>
          )}
        </Card>
      )}

      {/* 错误提示 */}
      {resultState.error && (
        <Alert 
          icon={<IconAlertCircle size={16} />} 
          title="生成错误" 
          color="red"
          variant="light"
          mb="md"
        >
          {resultState.error}
        </Alert>
      )}

      {/* 第一步：提纲生成 */}
      {activeMode === 'outline' && currentStep >= 1 && (
        <Card shadow="sm" padding="xl" withBorder mb="md">
          <Group position="apart" mb="md">
            <Group spacing="xs">
              <Title order={3}>📋 第一步：文章提纲</Title>
              {resultState.isGeneratingOutline && (
                <Badge color="blue" variant="light" size="sm">
                  生成中...
                </Badge>
              )}
              {resultState.outline && (
                <Badge color="green" variant="light" size="sm">
                  ✓ 已完成
                </Badge>
              )}
            </Group>
            <Group spacing="xs">
              <Button 
                size="sm"
                variant="light"
                onClick={handleGenerateOutline}
                loading={resultState.isGeneratingOutline}
                leftIcon={<IconRefresh size={14} />}
              >
                {resultState.outline ? '重新生成' : '生成提纲'}
              </Button>
            </Group>
          </Group>

          {/* 流式生成的提纲内容 */}
          {resultState.streamingOutline && (
            <div style={{
              padding: '16px',
              backgroundColor: '#f0f9ff',
              border: '1px solid #0ea5e9',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <Text size="sm" weight={600} mb="xs">实时生成中...</Text>
              <div style={{ fontSize: '14px', lineHeight: '1.5' }}>
                {resultState.streamingOutline}
              </div>
            </div>
          )}

          {/* 生成完成的提纲 */}
          {resultState.outline && (
            <div>
              <Text weight={600} mb="sm">
                标题：{resultState.outline.title}
              </Text>
              <Group spacing="md" mb="md">
                <Badge variant="outline">
                  {resultState.outline.totalSections || resultState.outline.outline?.length || 0} 个章节
                </Badge>
                <Badge variant="outline">
                  预计 {resultState.outline.estimatedWords || 0} 字
                </Badge>
              </Group>
              
              {currentStep >= 2 && (
                <Group spacing="md">
                  <Button
                    size="sm"
                    onClick={handleGenerateAllSections}
                    loading={isGeneratingAll}
                    leftIcon={<IconArrowRight size={14} />}
                  >
                    开始生成章节
                  </Button>
                </Group>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 第二步：章节生成 */}
      {activeMode === 'outline' && currentStep >= 2 && resultState.outline && (
        <Card shadow="sm" padding="xl" withBorder mb="md">
          <Group position="apart" mb="md">
            <Group spacing="xs">
              <Title order={3}>✍️ 第二步：章节写作</Title>
              <Badge color={Object.keys(resultState.sections || {}).length === (resultState.outline?.outline?.length || 0) ? 'green' : 'blue'} variant="light" size="sm">
                {Object.keys(resultState.sections || {}).length} / {resultState.outline?.outline?.length || 0} 已完成
              </Badge>
            </Group>
            <Group spacing="xs">
              <Button 
                size="sm"
                variant="light"
                onClick={handleGenerateAllSections}
                loading={isGeneratingAll}
                leftIcon={<IconEdit size={14} />}
              >
                生成全部章节
              </Button>
            </Group>
          </Group>

          {/* 生成进度 */}
          {isGeneratingAll && sectionProgress.total > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <Text size="sm" mb="xs">
                生成进度: {sectionProgress.current} / {sectionProgress.total}
              </Text>
              <Progress 
                value={(sectionProgress.current / sectionProgress.total) * 100} 
                color="blue"
                style={{ height: '8px' }}
              />
            </div>
          )}

          {/* 章节列表 */}
          <Stack spacing="sm">
            {resultState.outline.outline?.map((section, index) => {
              const isGenerated = resultState.sections && resultState.sections[index];
              const isGenerating = resultState.isGeneratingSection && resultState.currentSection === index;
              const isStreaming = resultState.streamingSection?.index === index;
              
              return (
                <Card key={index} withBorder padding="md" style={{
                  backgroundColor: isGenerated ? '#f0f9ff' : isGenerating ? '#fef3c7' : '#fafafa',
                  borderColor: isGenerated ? '#0ea5e9' : isGenerating ? '#f59e0b' : '#e5e7eb'
                }}>
                  <Group position="apart" align="flex-start">
                    <div style={{ flex: 1 }}>
                      <Group spacing="xs" mb="xs">
                        <Badge 
                          size="sm" 
                          color={isGenerated ? 'blue' : isGenerating ? 'yellow' : 'gray'}
                          variant="light"
                        >
                          第{section.sectionNumber}章
                        </Badge>
                        <Text weight={600} size="sm">
                          {section.title}
                        </Text>
                        {isGenerated && (
                          <Badge size="xs" color="green" variant="light">
                            ✓ 已生成
                          </Badge>
                        )}
                        {isGenerating && (
                          <Badge size="xs" color="orange" variant="light">
                            生成中...
                          </Badge>
                        )}
                      </Group>
                      
                      <Text size="xs" color="dimmed" mb="xs">
                        主题：{section.theme} | 预计{section.estimatedWords}字
                      </Text>
                      
                      {/* 显示流式生成内容预览 */}
                      {isStreaming && resultState.streamingSection?.content && (
                        <div style={{
                          marginTop: '8px',
                          padding: '8px',
                          backgroundColor: '#fffbeb',
                          border: '1px solid #fbbf24',
                          borderRadius: '4px',
                          maxHeight: '120px',
                          overflow: 'hidden',
                          fontSize: '12px',
                          lineHeight: '1.4'
                        }}>
                          {resultState.streamingSection.content.substring(0, 200)}...
                        </div>
                      )}
                    </div>
                    
                    <Group spacing="xs">
                      {isGenerated && (
                        <Tooltip label="预览内容">
                          <ActionIcon 
                            size="sm"
                            variant="light"
                            color="blue"
                            onClick={() => handlePreviewSection(index)}
                          >
                            <IconEye size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      
                      {!isGenerated && !isGenerating && (
                        <Tooltip label="生成这一章">
                          <ActionIcon 
                            size="sm"
                            variant="light"
                            color="blue"
                            onClick={() => handleGenerateSection(index)}
                            disabled={resultState.isGeneratingSection}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      
                      {isGenerated && (
                        <Tooltip label="重新生成">
                          <ActionIcon 
                            size="sm"
                            variant="light"
                            color="orange"
                            onClick={() => handleGenerateSection(index)}
                            disabled={resultState.isGeneratingSection}
                          >
                            <IconRefresh size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Group>
                </Card>
              );
            })}
          </Stack>

          {/* 进入下一步 */}
          {Object.keys(resultState.sections || {}).length === (resultState.outline?.outline?.length || 0) && 
           Object.keys(resultState.sections || {}).length > 0 && currentStep < 3 && (
            <Group position="center" mt="md">
              <Button
                onClick={() => setCurrentStep(3)}
                leftIcon={<IconArrowRight size={16} />}
              >
                进入第三步：合并初稿
              </Button>
            </Group>
          )}
        </Card>
      )}

      {/* 第三步：合并初稿 */}
      {activeMode === 'outline' && currentStep >= 3 && Object.keys(resultState.sections || {}).length > 0 && (
        <Card shadow="sm" padding="xl" withBorder mb="md">
          <Group position="apart" mb="md">
            <Group spacing="xs">
              <Title order={3}>📝 第三步：合并初稿</Title>
              {resultState.draftScript && (
                <Badge color="green" variant="light" size="sm">
                  ✓ 已完成
                </Badge>
              )}
            </Group>
            <Group spacing="xs">
              <Button 
                size="sm"
                onClick={handleGenerateDraft}
                leftIcon={<IconFile size={14} />}
                variant={resultState.draftScript ? 'light' : 'filled'}
              >
                {resultState.draftScript ? '重新合并初稿' : '合并为初稿'}
              </Button>
            </Group>
          </Group>

          {resultState.draftScript && (
            <div>
              <Text size="sm" color="dimmed" mb="sm">
                初稿已生成，共 {resultState.draftScript.wordCount} 字，包含 {resultState.draftScript.sectionsCount} 个章节
              </Text>
              
              {currentStep < 4 && (
                <Group position="center">
                  <Button
                    onClick={() => setCurrentStep(4)}
                    leftIcon={<IconArrowRight size={16} />}
                  >
                    进入第四步：风格润色
                  </Button>
                </Group>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 第四步：风格润色 */}
      {activeMode === 'outline' && currentStep >= 4 && resultState.draftScript && (
        <Card shadow="sm" padding="xl" withBorder mb="md">
          <Group position="apart" mb="md">
            <Group spacing="xs">
              <Title order={3}>🎨 第四步：风格润色</Title>
              {resultState.isGeneratingFinal && (
                <Badge color="blue" variant="light" size="sm">
                  润色中...
                </Badge>
              )}
              {resultState.finalScripts[selectedStyle] && (
                <Badge color="green" variant="light" size="sm">
                  ✓ 已完成
                </Badge>
              )}
            </Group>
          </Group>
          
          {/* 主操作区域 */}
          <Card withBorder padding="md" mb="md" style={{ backgroundColor: '#f8f9fa' }}>
            <Group position="apart" align="flex-start" mb="md">
              <div style={{ flex: 1 }}>
                <Title order={5} mb="sm">选择写作风格</Title>
                <Text size="sm" color="dimmed" mb="md">
                  基于 {resultState.draftScript.wordCount} 字的初稿进行风格润色
                </Text>
                
                {/* 风格选择器 */}
                <Group spacing="xs" mb="md">
                  {styleOptions.map((style) => (
                    <Button
                      key={style.value}
                      variant={selectedStyle === style.value ? 'filled' : 'light'}
                      size="sm"
                      onClick={() => setSelectedStyle(style.value)}
                    >
                      {style.label}
                    </Button>
                  ))}
                </Group>
                
                <Text size="xs" color="dimmed" mb="md">
                  当前风格：{styleOptions.find(s => s.value === selectedStyle)?.description || '默认风格'}
                </Text>
              </div>
              
              {/* 生成按钮 */}
              <div style={{ minWidth: '140px' }}>
                <Button
                  size="md"
                  onClick={() => handleGenerateFinal(selectedStyle)}
                  loading={resultState.isGeneratingFinal}
                  leftIcon={<IconBolt size={16} />}
                  style={{ width: '100%' }}
                >
                  生成访谈稿
                </Button>
                
                {resultState.finalScripts[selectedStyle] && (
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => handleGenerateFinal(selectedStyle)}
                    leftIcon={<IconRefresh size={14} />}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    重新生成
                  </Button>
                )}
              </div>
            </Group>
          </Card>

          {/* 流式生成的最终稿 */}
          {resultState.streamingFinal && (
            <Card withBorder padding="md" mb="md" style={{ backgroundColor: '#f0f9ff' }}>
              <Text size="sm" weight={600} mb="xs">正在生成 {selectedStyle} 风格的访谈稿...</Text>
              <div style={{ 
                maxHeight: '400px', 
                overflowY: 'auto',
                fontSize: '14px',
                lineHeight: '1.5'
              }}>
                <ReactMarkdown>
                  {resultState.streamingFinal.content}
                </ReactMarkdown>
              </div>
            </Card>
          )}

          {/* 最终稿内容 */}
          {resultState.finalScripts[selectedStyle] && !resultState.streamingFinal && (
            <Card withBorder padding="md" mb="md">
              <Group position="apart" mb="md">
                <Text weight={600}>最终访谈稿（{selectedStyle} 风格）</Text>
                <Group spacing="xs">
                  <Text size="xs" color="dimmed">
                    {resultState.finalScripts[selectedStyle].wordCount} 字
                  </Text>
                  {/* 导出按钮 */}
                  <Button
                    size="xs"
                    variant="light"
                    leftIcon={<IconDownload size={12} />}
                    onClick={() => handleExportInterviewScript('markdown')}
                  >
                    导出Markdown
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    leftIcon={<IconFileText size={12} />}
                    onClick={() => handleExportRawQA()}
                  >
                    导出原始问答
                  </Button>
                </Group>
              </Group>
              
              <div style={{ 
                maxHeight: '500px', 
                overflowY: 'auto', 
                border: '1px solid #eee', 
                borderRadius: '8px', 
                padding: '16px',
                backgroundColor: '#fafafa'
              }}>
                <ReactMarkdown>
                  {resultState.finalScripts[selectedStyle].content}
                </ReactMarkdown>
              </div>
            </Card>
          )}
        </Card>
      )}

      {/* 章节预览模态框 */}
      <Modal
        opened={previewModalOpen}
        onClose={handleClosePreview}
        title={`章节 ${selectedSectionIndex + 1} 预览`}
        size="lg"
      >
        {selectedSectionIndex !== null && resultState.sections[selectedSectionIndex] && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <ReactMarkdown>
              {resultState.sections[selectedSectionIndex]}
            </ReactMarkdown>
          </div>
        )}
      </Modal>
      
      {/* 重置访谈确认模态框 */}
      <Modal
        opened={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title="确认重置访谈"
        size="sm"
      >
        <Stack spacing="md">
          <Text>
            重置访谈将清除所有已生成的内容，包括：
          </Text>
          <Text size="sm" color="dimmed" ml="md">
            • 所有问题和回答记录<br/>
            • 已生成的提纲和章节<br/>
            • 访谈稿和初稿<br/>
            • 内容分析结果
          </Text>
          <Text weight={600} color="orange">
            此操作不可撤销，请确认是否继续？
          </Text>
          <Group position="right" mt="md">
            <Button variant="outline" onClick={() => setResetConfirmOpen(false)}>
              取消
            </Button>
            <Button color="red" onClick={handleResetConfirm}>
              确认重置
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* 操作按钮 */}
      <Group position="center" mt="xl" mb="xl">
        <Button 
          variant="outline" 
          onClick={() => setResetConfirmOpen(true)}
          leftIcon={<IconRefresh size={16} />}
          color="red"
        >
          开始新访谈
        </Button>
      </Group>
    </div>
  );
}
