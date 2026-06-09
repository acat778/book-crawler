package com.acat.crawler.mapper;

import com.acat.crawler.entity.BookEntity;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface BookMapper extends BaseMapper<BookEntity> {}
