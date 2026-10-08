import { useReducedEffects } from '../lib/motion'
import { AnimatePresence, motion } from 'framer-motion'

// 巨型数字：模块编号 + 构图锚点 + 转场元素（设计文档第三、十四章）
// 旧数字下沉，新数字从水底浮现
export default function GiantNumber({ value }: { value: string }) {
  const reduce = useReducedEffects()
  return (
    <div style={{ position: 'fixed', left: '-1%', bottom: '-6%', zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={value}
          className="giant-num"
          style={{ position: 'relative', fontSize: '44vh' }}
          initial={reduce ? false : { y: '60%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: '-40%', opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {value}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
