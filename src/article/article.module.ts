import { Module } from '@nestjs/common';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';
import { AiSearchModule } from '../ai-search/ai-search.module';

@Module({
  imports: [AiSearchModule],
  controllers: [ArticleController],
  providers: [ArticleService],
})
export class ArticleModule {}
