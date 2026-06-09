package com.acat.crawler.repository;

import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 段落存储（MongoDB paragraphs 集合）
 * 文档结构: { bookId: Long, chapterId: Long, paragraphs: [String] }
 */
@Repository
public class ParagraphRepository {

    private final MongoTemplate mongoTemplate;

    public ParagraphRepository(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public void saveParagraphs(Long bookId, Long chapterId, List<String> paragraphs) {
        // 先删除旧数据
        mongoTemplate.remove(
                new org.springframework.data.mongodb.core.query.Query(
                        org.springframework.data.mongodb.core.query.Criteria.where("bookId").is(bookId)
                                .and("chapterId").is(chapterId)),
                "paragraphs");

        Document doc = new Document();
        doc.put("bookId", bookId);
        doc.put("chapterId", chapterId);
        doc.put("paragraphs", paragraphs);
        mongoTemplate.save(doc, "paragraphs");
    }

    public long countByBookId(Long bookId) {
        return mongoTemplate.count(
                new org.springframework.data.mongodb.core.query.Query(
                        org.springframework.data.mongodb.core.query.Criteria.where("bookId").is(bookId)),
                "paragraphs");
    }
}
